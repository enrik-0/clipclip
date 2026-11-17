// Prepares desktop/stage/server: the compiled server with its production
// dependencies and the built UI. electron-builder copies it into the
// installer as resources/runtime/server (see "extraResources" in package.json).
//
// Run `pnpm build` at the repository root first; this script only packages
// what that build produced.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..");
const stageServer = path.join(desktopDir, "stage", "server");

for (const required of [path.join(repoRoot, "server", "dist", "index.js"), path.join(repoRoot, "ui", "dist", "index.html")]) {
  if (!fs.existsSync(required)) {
    console.error(`Missing ${required}. Run "pnpm build" at the repository root first.`);
    process.exit(1);
  }
}

fs.rmSync(path.join(desktopDir, "stage"), { recursive: true, force: true });

const deploy = spawnSync("pnpm", ["--filter", "@paperclipai/server", "deploy", "--prod", stageServer], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

// Workspace packages point `exports` at TypeScript sources for development and
// carry the compiled entry points in `publishConfig`, which `npm publish`
// applies and `pnpm deploy` does not. Apply it so the staged copies load their
// `dist` output.
const PUBLISH_OVERRIDES = ["main", "module", "types", "exports", "bin"];
const scopeDir = path.join(stageServer, "node_modules", "@paperclipai");
for (const name of fs.readdirSync(scopeDir)) {
  const manifestPath = path.join(fs.realpathSync(path.join(scopeDir, name)), "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const publish = manifest.publishConfig;
  if (!publish) continue;
  for (const key of PUBLISH_OVERRIDES) if (key in publish) manifest[key] = publish[key];
  // `pnpm deploy` hard-links injected workspace packages to the originals.
  // Removing the staged file first keeps the write from reaching the repository.
  fs.rmSync(manifestPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

fs.cpSync(path.join(repoRoot, "ui", "dist"), path.join(stageServer, "ui-dist"), { recursive: true });
console.log(`Staged runtime at ${stageServer}`);
