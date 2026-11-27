import { afterEach, describe, expect, it, vi } from "vitest";
import * as serverUtils from "@paperclipai/adapter-utils/server-utils";
import {
  discoverOpenCodeModels,
  ensureOpenCodeModelConfiguredAndAvailable,
  listOpenCodeModels,
  refreshOpenCodeModels,
  requireOpenCodeModelId,
  resetOpenCodeModelsCacheForTests,
} from "./models.js";
import { resetOpenCodeCliVersionCacheForTests } from "./cli-version.js";

describe("openCode models", () => {
  afterEach(() => {
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    delete process.env.OPENCODE_ALLOW_ALL_MODELS;
    resetOpenCodeModelsCacheForTests();
    resetOpenCodeCliVersionCacheForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns an empty list when discovery command is unavailable", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(listOpenCodeModels()).resolves.toEqual([]);
  });

  it("rejects when model is missing", async () => {
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({ model: "" }),
    ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
  });

  it("accepts a provider/model id without running discovery", () => {
    expect(requireOpenCodeModelId("openai/gpt-5.2-codex")).toBe(
      "openai/gpt-5.2-codex",
    );
  });

  it("rejects malformed provider/model ids before discovery", () => {
    expect(() => requireOpenCodeModelId("gpt-5.2-codex")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
    expect(() => requireOpenCodeModelId("openai/")).toThrow(
      "OpenCode requires `adapterConfig.model`",
    );
  });

  it("proceeds with the configured model when discovery cannot run (probe is best-effort, never fatal)", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openai/gpt-5",
      }),
    ).resolves.toEqual([{ id: "openai/gpt-5", label: "openai/gpt-5" }]);
  });

  it("skips the availability check when OPENCODE_ALLOW_ALL_MODELS is set in the run env", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
      }),
    ).resolves.toEqual([
      {
        id: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
        label: "anthropic/tensorix/deepseek/deepseek-chat-v3.1",
      },
    ]);
  });

  it("honours OPENCODE_ALLOW_ALL_MODELS from the process env", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND =
      "__paperclip_missing_opencode_command__";
    process.env.OPENCODE_ALLOW_ALL_MODELS = "1";
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "anthropic/gateway/some-model",
      }),
    ).resolves.toEqual([
      {
        id: "anthropic/gateway/some-model",
        label: "anthropic/gateway/some-model",
      },
    ]);
  });

  it("still enforces provider/model format when OPENCODE_ALLOW_ALL_MODELS is set", async () => {
    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "not-a-valid-id",
        env: { OPENCODE_ALLOW_ALL_MODELS: "true" },
      }),
    ).rejects.toThrow("OpenCode requires `adapterConfig.model`");
  });

  it("retries a transient `opencode models` failure with backoff before succeeding", async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "queued behind another opencode run",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: null,
        signal: null,
        timedOut: true,
        stdout: "",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "ollama/qwen2.5-coder:7b\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    const promise = discoverOpenCodeModels();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual([
      { id: "ollama/qwen2.5-coder:7b", label: "ollama/qwen2.5-coder:7b" },
    ]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("refreshes a stale non-empty catalog before rejecting the configured model", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout:
          "openrouter/example/current-model\nopenrouter/deepseek/deepseek-v4-flash-0731\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).resolves.toContainEqual({
      id: "openrouter/deepseek/deepseek-v4-flash-0731",
      label: "openrouter/deepseek/deepseek-v4-flash-0731",
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0]?.[2]).toEqual(["models"]);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects when a refreshed non-empty catalog omits the configured model", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/current-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow(
      "Configured OpenCode model is unavailable: openrouter/deepseek/deepseek-v4-flash-0731",
    );
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects from the original catalog when post-refresh enumeration returns no models", async () => {
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "Models cache refreshed\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      });

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow("Available models: openrouter/example/stale-model");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(spy.mock.calls[2]?.[2]).toEqual(["models"]);
  });

  it("still rejects from the original catalog when refresh fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(serverUtils, "runChildProcess")
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "openrouter/example/stale-model\n",
        stderr: "",
        pid: 1,
        startedAt: new Date().toISOString(),
      })
      .mockRejectedValueOnce(new Error("refresh unavailable"));

    await expect(
      ensureOpenCodeModelConfiguredAndAvailable({
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      }),
    ).rejects.toThrow("Available models: openrouter/example/stale-model");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[2]).toEqual(["models", "--refresh"]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'refresh failed for "openrouter/deepseek/deepseek-v4-flash-0731"',
      ),
    );
  });

  it("surfaces the last error once retries are exhausted", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "queued behind another opencode run",
      pid: 1,
      startedAt: new Date().toISOString(),
    });

    const promise = discoverOpenCodeModels();
    const assertion = expect(promise).rejects.toThrow(
      "`opencode models` failed: queued behind another opencode run",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(spy).toHaveBeenCalledTimes(3);
  });

  describe("with the agent's discovery context", () => {
    const ok = (stdout: string) => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout,
      stderr: "",
      pid: 1,
      startedAt: new Date().toISOString(),
    });

    // Answers `--version` with the given version and each `models` call with the next output.
    function mockCli(version: string, ...outputs: string[]) {
      let next = 0;
      return vi
        .spyOn(serverUtils, "runChildProcess")
        .mockImplementation(async (_runId, _command, args) => {
          if (args[0] === "--version") return ok(version);
          return ok(outputs[Math.min(next++, outputs.length - 1)] ?? "");
        });
    }

    const modelCalls = (spy: ReturnType<typeof mockCli>) =>
      spy.mock.calls.filter((call) => call[2][0] === "models");

    it("lists models with the agent's command and env, not the server's", async () => {
      process.env.PAPERCLIP_OPENCODE_COMMAND = "server-opencode";
      const spy = mockCli("1.18.32", "openai/gpt-5\n");

      await expect(
        listOpenCodeModels({
          config: {
            command: "agent-opencode",
            cwd: "/agent/cwd",
            env: { OPENAI_API_KEY: "agent-key" },
          },
        }),
      ).resolves.toEqual([{ id: "openai/gpt-5", label: "openai/gpt-5" }]);

      // Both the version probe and the listing use the agent's runtime.
      expect(spy).toHaveBeenCalledTimes(2);
      for (const call of spy.mock.calls) {
        expect(call[1]).toBe("agent-opencode");
        expect(call[3].cwd).toBe("/agent/cwd");
        expect(call[3].env.OPENAI_API_KEY).toBe("agent-key");
      }
    });

    it("lists without --standalone on OpenCode 1.x", async () => {
      const spy = mockCli("1.18.32", "openai/gpt-5\n");
      await listOpenCodeModels({ config: { command: "opencode" } });
      expect(modelCalls(spy).map((call) => call[2])).toEqual([["models"]]);
    });

    it("lists with --standalone on OpenCode 2.x", async () => {
      const spy = mockCli("2.0.1", "openai/gpt-5\n");
      await listOpenCodeModels({ config: { command: "opencode" } });
      expect(modelCalls(spy).map((call) => call[2])).toEqual([["models", "--standalone"]]);
    });

    it("lists with --standalone on OpenCode 2.x when there is no agent yet", async () => {
      const spy = mockCli("2.0.1", "openai/gpt-5\n");
      await listOpenCodeModels();
      expect(modelCalls(spy).map((call) => call[2])).toEqual([["models", "--standalone"]]);
    });

    // `opencode models --refresh` is an "Unrecognized flag" error on 2.3.0.
    it("refreshes on OpenCode 2.x by listing again, without --refresh, past the 60s cache", async () => {
      const spy = mockCli("opencode v2.3.0", "openai/old\n", "openai/new\n");
      const context = { config: { command: "opencode" } };

      await listOpenCodeModels(context);
      await expect(refreshOpenCodeModels(context)).resolves.toEqual([
        { id: "openai/new", label: "openai/new" },
      ]);
      // The refreshed catalog replaces the cached one.
      await expect(listOpenCodeModels(context)).resolves.toEqual([
        { id: "openai/new", label: "openai/new" },
      ]);

      expect(modelCalls(spy).map((call) => call[2])).toEqual([
        ["models", "--standalone"],
        ["models", "--standalone"],
      ]);
    });

    it("never passes --refresh when a 2.x run rechecks a missing model", async () => {
      const spy = mockCli("2.3.0", "openai/old\n", "openai/old\nopenai/wanted\n");

      await expect(
        ensureOpenCodeModelConfiguredAndAvailable({
          model: "openai/wanted",
          standalone: true,
        }),
      ).resolves.toContainEqual({ id: "openai/wanted", label: "openai/wanted" });

      expect(modelCalls(spy).map((call) => call[2])).toEqual([
        ["models", "--standalone"],
        ["models", "--standalone"],
      ]);
    });

    it("throws a readable error instead of returning an empty list when discovery fails", async () => {
      vi.useFakeTimers();
      vi.spyOn(serverUtils, "runChildProcess").mockResolvedValue({
        ...ok(""),
        exitCode: 1,
        stderr: "provider auth missing",
      });

      const promise = listOpenCodeModels({ config: { command: "opencode" } });
      const assertion = expect(promise).rejects.toThrow(
        "`opencode models` failed: provider auth missing",
      );
      await vi.runAllTimersAsync();
      await assertion;
    });

    it("drops the PATH dump from a spawn failure", async () => {
      vi.spyOn(serverUtils, "runChildProcess").mockRejectedValue(
        new Error('Failed to start command "nope" in "/w". Verify adapter command, working directory, and PATH (/usr/bin).'),
      );

      await expect(listOpenCodeModels({ config: { command: "nope" } })).rejects.toThrow(
        new Error('Failed to start command "nope" in "/w".'),
      );
    });

    it("refresh runs `opencode models --refresh` and bypasses the 60s cache", async () => {
      const spy = mockCli(
        "1.18.32",
        "openai/old\n",
        "Models cache refreshed\n",
        "openai/old\nopenai/new\n",
      );
      const context = { config: { command: "opencode" } };

      await expect(listOpenCodeModels(context)).resolves.toEqual([
        { id: "openai/old", label: "openai/old" },
      ]);
      // A second plain list is served from the cache without a new listing.
      await listOpenCodeModels(context);
      expect(modelCalls(spy)).toHaveLength(1);

      const refreshed = await refreshOpenCodeModels(context);
      expect(refreshed.map((model) => model.id)).toEqual([
        "openai/new",
        "openai/old",
      ]);
      expect(modelCalls(spy).map((call) => call[2])).toEqual([
        ["models"],
        ["models", "--refresh"],
        ["models"],
      ]);
    });
  });
});
