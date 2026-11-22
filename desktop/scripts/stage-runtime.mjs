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
import { build } from "esbuild";

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

// The staged tree must not contain symlinks or junctions: the installer
// archive does not keep them, and pnpm's default layout is made of them, so the
// installed app would lose every top-level package. A hoisted layout is plain
// directories. The root manifest patches `acpx`, which is not part of this
// production subset, and pnpm refuses a hoisted install with an unused patch
// unless `allowNonAppliedPatches` is set. Set it only for this run and always
// restore the manifest byte for byte.
const rootManifestPath = path.join(repoRoot, "package.json");
const rootManifest = fs.readFileSync(rootManifestPath, "utf8");
if (!rootManifest.includes('"pnpm": {')) {
  console.error('Could not find the "pnpm" section in the root package.json.');
  process.exit(1);
}
let deploy;
try {
  fs.writeFileSync(rootManifestPath, rootManifest.replace('"pnpm": {', '"pnpm": {\n    "allowNonAppliedPatches": true,'));
  deploy = spawnSync(
    "pnpm",
    // pnpm's hoisted linker fails on an absolute output path on another drive,
    // so pass the path relative to the repository.
    ["--filter", "@paperclipai/server", "deploy", "--prod", path.relative(repoRoot, stageServer)],
    {
      cwd: repoRoot,
      env: { ...process.env, npm_config_node_linker: "hoisted" },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
} finally {
  fs.writeFileSync(rootManifestPath, rootManifest);
}
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

// Windows tools, including the installer's archive extractor, silently skip
// files whose full path is longer than 260 characters. `@microsoft/teams.graph-endpoints`
// is a generated SDK of ~3,700 files in deeply nested folders. Only its root
// export is imported (by `@chat-adapter/teams`), so replace its `dist` with one
// bundled file per entry point.
const graphEndpoints = path.join(stageServer, "node_modules", "@microsoft", "teams.graph-endpoints");
if (fs.existsSync(graphEndpoints)) {
  const bundled = path.join(graphEndpoints, "bundled");
  for (const [entry, format] of [["index.mjs", "esm"], ["index.js", "cjs"]]) {
    await build({
      entryPoints: [path.join(graphEndpoints, "dist", entry)],
      outfile: path.join(bundled, entry),
      bundle: true,
      format,
      platform: "node",
      packages: "external",
      logLevel: "warning",
    });
  }
  fs.rmSync(path.join(graphEndpoints, "dist"), { recursive: true, force: true });
  fs.renameSync(bundled, path.join(graphEndpoints, "dist"));
}

fs.cpSync(path.join(repoRoot, "ui", "dist"), path.join(stageServer, "ui-dist"), { recursive: true });

// Budget for the longest path below the staged server folder. The installed
// prefix (install dir + "\resources\runtime\server") is about 80 characters in
// the default location and 95 for a 20-character user name; stay under 260.
const MAX_RELATIVE_PATH = 160;
let longest = { length: 0, file: "" };
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = full.slice(stageServer.length);
    if (relative.length > longest.length) longest = { length: relative.length, file: relative };
    if (entry.isDirectory()) walk(full);
  }
})(stageServer);
if (longest.length > MAX_RELATIVE_PATH) {
  console.error(`A staged path is ${longest.length} characters long (limit ${MAX_RELATIVE_PATH}): ${longest.file}`);
  console.error("It would be skipped or broken on Windows. Bundle or prune the package that contains it.");
  process.exit(1);
}
console.log(`Longest staged path: ${longest.length} characters`);
console.log(`Staged runtime at ${stageServer}`);
