#!/usr/bin/env node
// Connects an Obsidian vault to a Paperclip company through an existing stdio
// MCP server (default: @bitbonsai/mcpvault, installed locally beforehand).
//
// It needs no change to Paperclip: it registers a company stdio command
// template and creates a local_stdio connection that uses it.
//
//   node experiments/notes/connect-obsidian.mjs \
//     --company <companyId> --vault "C:\Users\me\Notes" \
//     --server-dir "C:\Users\me\.paperclip-notes\mcpvault" [--read-only] [--dry-run]
//
// See doc/connections/OBSIDIAN.md.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_PACKAGE = "@bitbonsai/mcpvault";
const HANDSHAKE_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const options = { api: "http://localhost:3100", package: DEFAULT_PACKAGE, name: "Obsidian vault", headers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };
    if (flag === "--api") options.api = value().replace(/\/+$/, "");
    else if (flag === "--company") options.company = value();
    else if (flag === "--vault") options.vault = value();
    else if (flag === "--server-dir") options.serverDir = value();
    else if (flag === "--server-entry") options.serverEntry = value();
    else if (flag === "--package") options.package = value();
    else if (flag === "--name") options.name = value();
    else if (flag === "--template-id") options.templateId = value();
    else if (flag === "--header") options.headers.push(value());
    else if (flag === "--read-only") options.readOnly = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

const HELP = `Connect an Obsidian vault to a Paperclip company.

Required:
  --company <id>        Company id.
  --vault <path>        Absolute path of the vault folder. Not a drive root.
  --server-dir <path>   Folder where the MCP server package is installed
                        (npm install --prefix <path> ${DEFAULT_PACKAGE}@<version>).
                        Use --server-entry <file.js> to name the entry file directly.

Optional:
  --read-only           Agents can read and search notes but not change them.
  --name <text>         Connection name. Default: "Obsidian vault".
  --template-id <id>    Template id. Default: obsidian-vault or obsidian-vault-read-only.
  --package <name>      Package inside --server-dir. Default: ${DEFAULT_PACKAGE}.
  --api <url>           Paperclip API. Default: http://localhost:3100.
  --header "K: V"       Extra request header, for an authenticated instance. Repeatable.
  --dry-run             Read the server's tools and print the requests. Send nothing.
`;

/** The package's stdio entry file, read from its own package.json. */
function resolveServerEntry(options) {
  if (options.serverEntry) return path.resolve(options.serverEntry);
  if (!options.serverDir) throw new Error("Give --server-dir or --server-entry");
  const packageDir = path.resolve(options.serverDir, "node_modules", ...options.package.split("/"));
  const manifestPath = path.join(packageDir, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`${options.package} is not installed in ${options.serverDir}. Run: npm install --prefix "${options.serverDir}" ${options.package}@<version>`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  const entry = bin ?? manifest.main;
  if (!entry) throw new Error(`${options.package} declares no bin or main entry`);
  return { entry: path.join(packageDir, entry), version: manifest.version ?? null };
}

function assertVault(vault) {
  if (!vault) throw new Error("Give --vault");
  const resolved = path.resolve(vault);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`The vault folder does not exist: ${resolved}`);
  // mcpvault mishandles a vault at a drive or share root; a root also exposes far more than notes.
  if (path.parse(resolved).root === resolved) throw new Error("The vault cannot be a drive or share root. Use a folder.");
  return resolved;
}

/** Starts the server once and reads its tool list over the MCP stdio protocol. */
function readServerTools(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;
    const finish = (error, tools) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(tools);
    };
    const timer = setTimeout(() => finish(new Error(`The MCP server did not answer in ${HANDSHAKE_TIMEOUT_MS / 1000} s. ${stderr.trim()}`)), HANDSHAKE_TIMEOUT_MS);
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    child.on("error", (error) => finish(new Error(`Could not start the MCP server: ${error.message}`)));
    child.on("exit", (code) => finish(new Error(`The MCP server exited with code ${code} before it listed its tools. ${stderr.trim()}`)));
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.error) return finish(new Error(`The MCP server returned an error: ${JSON.stringify(message.error)}`));
        if (message.id === 1) {
          send({ method: "notifications/initialized" });
          send({ id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          finish(null, Array.isArray(message.result?.tools) ? message.result.tools : []);
        }
      }
    });
    send({ id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "paperclip-connect-obsidian", version: "1" },
    } });
  });
}

/** Paperclip stores the descriptor; the gateway uses it for the catalog and the permission tier. */
function toTemplateTool(tool) {
  return {
    name: tool.name,
    ...(tool.title ? { title: String(tool.title).slice(0, 240) } : {}),
    ...(tool.description ? { description: String(tool.description).slice(0, 8000) } : {}),
    ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

async function request(options, method, route, body) {
  const headers = { "Content-Type": "application/json" };
  for (const header of options.headers) {
    const separator = header.indexOf(":");
    if (separator > 0) headers[header.slice(0, separator).trim()] = header.slice(separator + 1).trim();
  }
  const response = await fetch(`${options.api}/api${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  if (!options.company && !options.dryRun) throw new Error("Give --company");
  const vault = assertVault(options.vault);
  const resolved = resolveServerEntry(options);
  const entry = typeof resolved === "string" ? resolved : resolved.entry;
  const version = typeof resolved === "string" ? null : resolved.version;
  if (!existsSync(entry)) throw new Error(`The MCP server entry file does not exist: ${entry}`);

  // The gateway starts the command without a shell for every call, so the
  // template names the Node binary and the entry file, never npx.
  const command = process.execPath;
  const args = [entry, vault, ...(options.readOnly ? ["--read-only"] : [])];
  const tools = (await readServerTools(command, args)).map(toTemplateTool);
  if (tools.length === 0) throw new Error("The MCP server listed no tools");

  const templateId = options.templateId ?? (options.readOnly ? "obsidian-vault-read-only" : "obsidian-vault");
  const template = {
    templateId,
    name: options.readOnly ? "Obsidian vault (read only)" : "Obsidian vault",
    description: `Notes in ${vault} through ${options.package}${version ? `@${version}` : ""}.`,
    command, args, envKeys: [], tools,
  };
  const connection = {
    name: options.name, transport: "local_stdio", authKind: "none", enabled: true,
    config: { templateId },
  };

  process.stdout.write(`MCP server: ${options.package}${version ? `@${version}` : ""}\nVault: ${vault}\nTools (${tools.length}): ${tools.map((tool) => tool.name).join(", ")}\n`);
  if (options.dryRun) {
    process.stdout.write(`\nDry run. Nothing was sent.\n${JSON.stringify({ template: { ...template, tools: `${tools.length} tools` }, connection }, null, 2)}\n`);
    return;
  }
  const createdTemplate = await request(options, "POST", `/companies/${options.company}/tools/stdio-templates`, template);
  const createdConnection = await request(options, "POST", `/companies/${options.company}/tools/connections`, connection);
  process.stdout.write(`\nTemplate: ${createdTemplate.templateId}\nConnection: ${createdConnection.id ?? createdConnection.connection?.id ?? "created"}\n`
    + "Next: open Apps in Paperclip, open the connection, and choose which agents can use which tools.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
