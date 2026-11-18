import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalTrustedAgentJwtSecret } from "../local-agent-jwt-secret.js";

describe("ensureLocalTrustedAgentJwtSecret (#16)", () => {
  let dir: string;
  let envFilePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-agent-jwt-"));
    envFilePath = path.join(dir, "instances", "default", ".env");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates and saves a secret on the first local trusted start", () => {
    const env: NodeJS.ProcessEnv = {};
    const result = ensureLocalTrustedAgentJwtSecret({ env, envFilePath, deploymentMode: "local_trusted" });

    expect(result).toEqual({ status: "created", envFilePath });
    expect(env.PAPERCLIP_AGENT_JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    const saved = parse(fs.readFileSync(envFilePath, "utf8"));
    expect(saved.PAPERCLIP_AGENT_JWT_SECRET).toBe(env.PAPERCLIP_AGENT_JWT_SECRET);
  });

  it("keeps the saved secret on the next start", () => {
    const first: NodeJS.ProcessEnv = {};
    ensureLocalTrustedAgentJwtSecret({ env: first, envFilePath, deploymentMode: "local_trusted" });
    const before = fs.readFileSync(envFilePath, "utf8");

    // The next start loads the saved file into the environment first.
    const next: NodeJS.ProcessEnv = { ...parse(before) };
    const result = ensureLocalTrustedAgentJwtSecret({ env: next, envFilePath, deploymentMode: "local_trusted" });

    expect(result.status).toBe("present");
    expect(next.PAPERCLIP_AGENT_JWT_SECRET).toBe(first.PAPERCLIP_AGENT_JWT_SECRET);
    expect(fs.readFileSync(envFilePath, "utf8")).toBe(before);
  });

  it("keeps the other lines of an existing env file", () => {
    fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
    fs.writeFileSync(envFilePath, "# mine\nPAPERCLIP_TOOL_ACTION_SIGNING_SECRET=keep-me\n");

    ensureLocalTrustedAgentJwtSecret({ env: {}, envFilePath, deploymentMode: "local_trusted" });

    const contents = fs.readFileSync(envFilePath, "utf8");
    expect(contents.startsWith("# mine\nPAPERCLIP_TOOL_ACTION_SIGNING_SECRET=keep-me\n")).toBe(true);
    expect(parse(contents).PAPERCLIP_AGENT_JWT_SECRET).toBeTruthy();
  });

  it("does nothing when a secret is already in the environment", () => {
    for (const env of [{ PAPERCLIP_AGENT_JWT_SECRET: "set" }, { BETTER_AUTH_SECRET: "set" }] as NodeJS.ProcessEnv[]) {
      const result = ensureLocalTrustedAgentJwtSecret({ env, envFilePath, deploymentMode: "local_trusted" });
      expect(result.status).toBe("present");
    }
    expect(fs.existsSync(envFilePath)).toBe(false);
  });

  it("never creates a secret outside local trusted mode", () => {
    const env: NodeJS.ProcessEnv = {};
    const result = ensureLocalTrustedAgentJwtSecret({ env, envFilePath, deploymentMode: "authenticated" });

    expect(result.status).toBe("skipped");
    expect(env.PAPERCLIP_AGENT_JWT_SECRET).toBeUndefined();
    expect(fs.existsSync(envFilePath)).toBe(false);
  });

  it("still sets the secret for this process when the file cannot be written", () => {
    // A regular file where the instance directory should be makes the write fail.
    fs.writeFileSync(path.join(dir, "instances"), "not a directory");
    const env: NodeJS.ProcessEnv = {};

    const result = ensureLocalTrustedAgentJwtSecret({ env, envFilePath, deploymentMode: "local_trusted" });

    expect(result.status).toBe("unsaved");
    expect(result).toHaveProperty("error");
    expect(env.PAPERCLIP_AGENT_JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });
});
