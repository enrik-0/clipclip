import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { models as openCodeFallbackModels } from "@paperclipai/adapter-opencode-local";
import type { ServerAdapterModule } from "../adapters/index.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
  ensureMembership: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
  resolveAdapterConfigForRuntime: vi.fn(async (_companyId: string, config: Record<string, unknown>) => ({ config })),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockListOpenCodeModels = vi.hoisted(() => vi.fn());
const mockRefreshOpenCodeModels = vi.hoisted(() => vi.fn());
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
  getBundle: vi.fn(),
  readFile: vi.fn(),
  updateBundle: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  exportFiles: vi.fn(),
  ensureManagedBundle: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelActiveForAgent: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("@paperclipai/adapter-opencode-local/server", async () => {
    const actual = await vi.importActual<typeof import("@paperclipai/adapter-opencode-local/server")>("@paperclipai/adapter-opencode-local/server");
    return {
      ...actual,
      listOpenCodeModels: mockListOpenCodeModels,
      refreshOpenCodeModels: mockRefreshOpenCodeModels,
    };
  });

  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => mockAgentInstructionsService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    builtInAgentService: () => ({ ensureCompanyDefaultAgentGrants: vi.fn() }),
    companySkillService: () => mockCompanySkillService,
    budgetService: () => mockBudgetService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    issueService: () => ({}),
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
    syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
    workspaceOperationService: () => ({}),
  }));

  vi.doMock("../services/secrets.js", async () => {
    const actual = await vi.importActual<typeof import("../services/secrets.js")>("../services/secrets.js");
    return { ...actual, secretService: () => mockSecretService };
  });

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));
}

registerModuleMocks();
const [{ agentRoutes }, { errorHandler }] = await Promise.all([
  vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
  vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
]);

const refreshableAdapterType = "refreshable_adapter_route_test";

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

async function unregisterTestAdapter(type: string) {
  const { unregisterServerAdapter } = await import("../adapters/index.js");
  unregisterServerAdapter(type);
}

describe("adapter model refresh route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockResolvedValue([]);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.decide.mockResolvedValue({ allowed: true });
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
    mockEnvironmentService.getById.mockReset();
    mockEnvironmentService.getById.mockResolvedValue(null);
    mockListOpenCodeModels.mockReset();
    mockListOpenCodeModels.mockResolvedValue([{ id: "dynamic-opencode-model", label: "dynamic-opencode-model" }]);
    mockRefreshOpenCodeModels.mockReset();
    mockRefreshOpenCodeModels.mockResolvedValue([{ id: "refreshed-opencode-model", label: "refreshed-opencode-model" }]);
    mockAgentService.getById.mockReset();
    mockSecretService.resolveAdapterConfigForRuntime.mockClear();
    await unregisterTestAdapter(refreshableAdapterType);
  });

  afterEach(async () => {
    await unregisterTestAdapter(refreshableAdapterType);
  });

  it.each([
    { qualification: "pending", qualified: false, status: 422 },
    { qualification: "released", qualified: true, status: 200 },
  ])("keeps $qualification Kimi model selection separate from other provider catalogs", async ({ qualified, status }) => {
    const { PAPERCLIP_RUNNER_ACPX_PROFILES } = await import("@paperclipai/adapter-utils");
    const kimi = PAPERCLIP_RUNNER_ACPX_PROFILES.find(profile => profile.value === "kimi")! as { qualified: boolean };
    const previousQualified = kimi.qualified;
    const previousAdmission = process.env.PAPERCLIP_ACPX_CANDIDATE_ADMISSION;
    try {
      kimi.qualified = qualified;
      delete process.env.PAPERCLIP_ACPX_CANDIDATE_ADMISSION;
      const app = await createApp();
      const res = await requestApp(app, baseUrl =>
        request(baseUrl).get("/api/companies/company-1/adapters/paperclip_runner/models?provider=acpx&acpxAgent=kimi&refresh=1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(status);
      if (qualified) expect(res.body).toEqual([]);
      else expect(res.body).toMatchObject({ code: "paperclip_runner_acpx_agent_unavailable" });
      expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    } finally {
      kimi.qualified = previousQualified;
      if (previousAdmission === undefined) delete process.env.PAPERCLIP_ACPX_CANDIDATE_ADMISSION;
      else process.env.PAPERCLIP_ACPX_CANDIDATE_ADMISSION = previousAdmission;
    }
  });

  it("uses refreshModels when refresh=1 is requested", async () => {
    const listModels = vi.fn(async () => [{ id: "stale-model", label: "stale-model" }]);
    const refreshModels = vi.fn(async () => [{ id: "fresh-model", label: "fresh-model" }]);
    const { registerServerAdapter } = await import("../adapters/index.js");
    const adapter: ServerAdapterModule = {
      type: refreshableAdapterType,
      execute: async () => ({ exitCode: 0, signal: null, timedOut: false }),
      testEnvironment: async () => ({
        adapterType: refreshableAdapterType,
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      listModels,
      refreshModels,
    };
    registerServerAdapter(adapter);

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).get(`/api/companies/company-1/adapters/${refreshableAdapterType}/models?refresh=1`),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([{ id: "fresh-model", label: "fresh-model" }]);
    expect(refreshModels).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
  });

  it("skips OpenCode model discovery for non-local environments", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: "env-1",
      companyId: "company-1",
      name: "Remote SSH",
      driver: "ssh",
      config: {},
    });

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?environmentId=env-1"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual(openCodeFallbackModels);
    expect(mockListOpenCodeModels).not.toHaveBeenCalled();
  });

  it("keeps OpenCode model discovery enabled for local environments", async () => {
    mockEnvironmentService.getById.mockResolvedValue({
      id: "env-1",
      companyId: "company-1",
      name: "Local",
      driver: "local",
      config: {},
    });

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?environmentId=env-1"),
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([{ id: "dynamic-opencode-model", label: "dynamic-opencode-model" }]);
    expect(mockListOpenCodeModels).toHaveBeenCalledTimes(1);
  });

  describe("opencode_local with agentId", () => {
    const agent = {
      id: "agent-1",
      companyId: "company-1",
      adapterType: "opencode_local",
      adapterConfig: { command: "/agent/opencode", cwd: "/agent/cwd", env: { OPENAI_API_KEY: { type: "secret_ref" } } },
    };
    const resolvedConfig = { command: "/agent/opencode", cwd: "/agent/cwd", env: { OPENAI_API_KEY: "resolved-key" } };

    beforeEach(() => {
      mockAgentService.getById.mockResolvedValue(agent);
      mockSecretService.resolveAdapterConfigForRuntime.mockResolvedValue({ config: resolvedConfig });
    });

    it("discovers models with the agent's resolved config", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?agentId=agent-1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(mockSecretService.resolveAdapterConfigForRuntime).toHaveBeenCalledWith(
        "company-1",
        agent.adapterConfig,
        expect.anything(),
        expect.objectContaining({ adapterType: "opencode_local" }),
      );
      expect(mockListOpenCodeModels).toHaveBeenCalledWith({ config: resolvedConfig });
    });

    it("answers 422 with the discovery error instead of the static fallback model", async () => {
      mockListOpenCodeModels.mockRejectedValue(new Error("`opencode models` failed: provider auth missing"));

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?agentId=agent-1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error).toContain("provider auth missing");
    });

    it("refresh=1 calls the adapter refresh with the agent's resolved config", async () => {
      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?agentId=agent-1&refresh=1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual([{ id: "refreshed-opencode-model", label: "refreshed-opencode-model" }]);
      expect(mockRefreshOpenCodeModels).toHaveBeenCalledWith({ config: resolvedConfig });
      expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    });

    it("does not resolve secrets when the actor may not update the agent", async () => {
      mockAccessService.decide.mockResolvedValue({ allowed: false, explanation: "no permission" });

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?agentId=agent-1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(mockSecretService.resolveAdapterConfigForRuntime).not.toHaveBeenCalled();
      expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    });

    it("does not read another company's agent", async () => {
      mockAgentService.getById.mockResolvedValue({ ...agent, companyId: "company-2" });

      const app = await createApp();
      const res = await requestApp(app, (baseUrl) =>
        request(baseUrl).get("/api/companies/company-1/adapters/opencode_local/models?agentId=agent-1"),
      );

      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(mockSecretService.resolveAdapterConfigForRuntime).not.toHaveBeenCalled();
      expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    });
  });
});
