import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// embedded-postgres' stop() used to wait forever for an 'exit' event that had
// already fired when the postmaster died before stop() was called (for example
// killed by another tool or a crashed run). `migrate` then never exited and
// `pnpm dev` hung. The repo patch makes stop() return immediately in that case.

type Instance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  process?: { pid?: number };
};

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

const directories: string[] = [];
const instances: Instance[] = [];

afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.stop().catch(() => undefined);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function startInstance(): Promise<Instance> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = mkdtempSync(path.join(os.tmpdir(), "paperclip-pg-stop-"));
  directories.push(databaseDir);
  const instance = new (EmbeddedPostgres as unknown as new (options: object) => Instance)({
    databaseDir,
    user: "paperclip",
    password: "paperclip",
    port: await freePort(),
    persistent: true,
    onLog: () => undefined,
    onError: () => undefined,
  });
  instances.push(instance);
  await instance.initialise();
  await instance.start();
  return instance;
}

describe("embedded postgres stop", () => {
  it("returns instead of hanging when the postmaster already exited", async () => {
    const instance = await startInstance();
    const pid = instance.process?.pid;
    expect(pid).toBeGreaterThan(0);
    process.kill(pid!, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const outcome = await Promise.race([
      instance.stop().then(() => "stopped"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 15_000)),
    ]);
    expect(outcome).toBe("stopped");
  }, 60_000);

  it("stops a running instance", async () => {
    const instance = await startInstance();
    const outcome = await Promise.race([
      instance.stop().then(() => "stopped"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 30_000)),
    ]);
    expect(outcome).toBe("stopped");
  }, 90_000);
});
