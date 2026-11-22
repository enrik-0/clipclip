// pnpm runs package.json scripts with cmd.exe on Windows. A step that needs a
// POSIX shell fails there unless the developer points npm_config_script_shell
// at bash. Package scripts use scripts/fsx.mjs, scripts/run-bash.mjs and
// cross-env instead; this test keeps new POSIX-only steps out.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const POSIX_ONLY = [
  [/^(rm|cp|mv|mkdir|chmod|ln|touch|cat|ls|sed|xargs|test|export)\b/, "use node scripts/fsx.mjs (or another Node script)"],
  [/^\.{1,2}\//, "use node scripts/run-bash.mjs <script> for a shell script"],
  [/^bash\b/, "use node scripts/run-bash.mjs <script>; plain bash can start WSL on Windows"],
  [/^if\b|^\[/, "use node scripts/fsx.mjs (for example mv --if-exists)"],
  [/^[A-Za-z_][A-Za-z0-9_]*=/, "use cross-env NAME=value <command>"],
  [/\$\(|`/, "command substitution needs a POSIX shell"],
  [/(^|\s)(\||;)(\s|$)/, "pipes and ; need a POSIX shell in this form"],
];

function packageJsonFiles() {
  return execFileSync("git", ["ls-files", "--", "package.json", "**/package.json"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((file) => !/(^|\/)(node_modules|fixtures?|__fixtures__|test-fixtures)\//.test(file));
}

function unquoted(step) {
  return step.replace(/"[^"]*"/g, '""');
}

test("package.json scripts run under cmd.exe as well as a POSIX shell", () => {
  const problems = [];
  const files = packageJsonFiles();
  assert.ok(files.length > 10, "expected the workspace package.json files");
  for (const file of files) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      for (const step of script.split(/\s+&&\s+|\s+\|\|\s+/)) {
        const bare = unquoted(step.trim());
        for (const [pattern, hint] of POSIX_ONLY) {
          if (pattern.test(bare)) problems.push(`${file} "${name}": \`${step.trim()}\` - ${hint}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("unquoted globs are not passed to fsx", () => {
  const problems = [];
  for (const file of packageJsonFiles()) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      for (const step of script.split(/\s+&&\s+/)) {
        if (!/scripts\/fsx\.mjs /.test(step)) continue;
        // cmd.exe passes a glob through as text and sh expands it; quote it so
        // fsx always expands it the same way.
        if (/[*?]/.test(unquoted(step))) problems.push(`${file} "${name}": \`${step}\``);
      }
    }
  }
  assert.deepEqual(problems, []);
});
