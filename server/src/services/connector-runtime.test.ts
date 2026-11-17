import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { applyConnectorSkills, isConnectorSkill, resolveConnectorAssignments } from "./connector-runtime.js";

const resolvers = vi.hoisted(() => ({
  browser: vi.fn(), speko: vi.fn(), obsidian: vi.fn(), slack: vi.fn(), inboxes: vi.fn(),
}));
vi.mock("./native-runtime/assigned-mcp-tools.js", () => ({ getAssignedMcpGateway: () => ({ browserUseResources: resolvers.browser, obsidianVaultResources: resolvers.obsidian }) }));
vi.mock("./voice/speko-agent-tools.js", () => ({ spekoAssignedResources: resolvers.speko }));
vi.mock("./connectors/slack.js", () => ({ slackAssignedResource: resolvers.slack, executeGovernedSlackTool: vi.fn() }));
vi.mock("./email-channels.js", () => ({ emailChannelService: () => ({ assignedInboxes: resolvers.inboxes }) }));

afterEach(() => vi.resetAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("connector assignment preparation", () => {
  it("starts independent resolvers together and retains connector order", async () => {
    const pending = Array.from({ length: 5 }, () => deferred<Array<{ id: string; label: string; connectionId: string; address: string }>>());
    Object.values(resolvers).forEach((resolver, i) => resolver.mockReturnValue(pending[i].promise));
    const assignments = resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent" });
    await vi.waitFor(() => Object.values(resolvers).forEach(resolver => expect(resolver).toHaveBeenCalledOnce()));
    for (const i of [4, 3, 2, 1, 0]) pending[i].resolve([{ id: `resource-${i}`, connectionId: `connection-${i}`, label: "Resource", address: "inbox@example.com" }]);
    expect((await assignments).map(assignment => assignment.key)).toEqual(["browser-use-cloud", "speko", "obsidian", "slack", "agentmail"]);
  });

  it("settles outstanding resolution before propagating a failed connector", async () => {
    const slack = deferred<[]>();
    resolvers.browser.mockResolvedValue([]);
    resolvers.speko.mockRejectedValue(new Error("Speko unavailable"));
    resolvers.obsidian.mockResolvedValue([]);
    resolvers.slack.mockReturnValue(slack.promise);
    resolvers.inboxes.mockResolvedValue([]);
    let settled = false;
    const assignments = resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent" });
    const result = expect(assignments).rejects.toThrow("Speko unavailable").finally(() => { settled = true; });
    await vi.waitFor(() => expect(resolvers.slack).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    slack.resolve([]);
    await result;
  });
});

describe("Obsidian notes skill", () => {
  const only = (resources: Array<{ id: string; label: string; connectionId: string }>) => {
    resolvers.browser.mockResolvedValue([]);
    resolvers.speko.mockResolvedValue([]);
    resolvers.slack.mockResolvedValue([]);
    resolvers.inboxes.mockResolvedValue([]);
    resolvers.obsidian.mockResolvedValue(resources);
  };

  it("is given to an agent that may use a vault, with its vaults listed", async () => {
    only([
      { id: "vault-1", connectionId: "vault-1", label: "Procedures vault" },
      { id: "vault-2", connectionId: "vault-2", label: "Deliverables vault" },
    ]);
    const assignments = await resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent", runId: "run", issueId: "issue" });
    expect(assignments).toMatchObject([{ key: "obsidian", skillKey: "paperclipai/paperclip/obsidian-notes", tools: [] }]);

    const config = await applyConnectorSkills({}, [], assignments);
    const skill = config.paperclipRuntimeSkills.find(entry => entry.key === "paperclipai/paperclip/obsidian-notes");
    expect(skill).toMatchObject({ runtimeName: "obsidian-notes", sourceStatus: "available" });
    const markdown = await readFile(path.join(skill!.source, "SKILL.md"), "utf8");
    expect(markdown).toContain("name: obsidian-notes");
    expect(markdown).toContain("## Keeping memory");
    expect(markdown).toContain("Procedures vault");
    expect(markdown).toContain("Deliverables vault");
  });

  it("is not given to an agent with no vault, and cannot be chosen by hand", async () => {
    only([]);
    const assignments = await resolveConnectorAssignments({} as Db, { companyId: "company", agentId: "agent", runId: "run", issueId: "issue" });
    expect(assignments).toEqual([]);
    const config = await applyConnectorSkills({}, [], assignments);
    expect(config.paperclipRuntimeSkills).toEqual([]);
    expect(isConnectorSkill("paperclipai/paperclip/obsidian-notes")).toBe(true);
  });
});
