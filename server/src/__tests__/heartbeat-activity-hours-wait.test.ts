import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, heartbeatRunEvents, heartbeatRuns, issues } from "@paperclipai/db";
import type { ActivityOutsideHoursMode, CompanyActivitySchedule } from "@paperclipai/shared";
import { registerServerAdapter, unregisterServerAdapter } from "../adapters/index.js";
import { heartbeatService } from "../services/heartbeat.js";
import { executionProjectionsForRuns } from "../services/execution-projection.js";
import { recoveryPostgresSupport, startRecoveryPostgres } from "./helpers/recovery-postgres.js";

const describePostgres = recoveryPostgresSupport.supported ? describe : describe.skip;
if (!recoveryPostgresSupport.supported) console.warn(`Skipping activity hours wait tests: ${recoveryPostgresSupport.reason}`);

/**
 * A company with activity hours lets Paperclip start work on its own only
 * inside its windows. Work that falls outside waits for the next opening.
 */
describePostgres("heartbeat activity hours wait", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  const adapterType = "codex_local";
  const dispatched = new Set<string>();
  const oldHome = process.env.PAPERCLIP_HOME;
  let home: string;
  // Every night 18:00–04:00 UTC. Ten in the morning is outside; the window opens at 18:00.
  const outside = new Date("2026-11-13T10:00:00.000Z");
  const opensAt = new Date("2026-11-13T18:00:00.000Z");
  const inside = new Date("2026-11-13T20:00:00.000Z");
  let clock = outside;

  beforeAll(async () => {
    temporary = await startRecoveryPostgres("heartbeat-activity-hours-");
    db = createDb(temporary.connectionString);
    home = await mkdtemp(path.join(tmpdir(), "paperclip-activity-hours-"));
    process.env.PAPERCLIP_HOME = home;
    heartbeat = heartbeatService(db, { activityHoursNow: () => clock });
    registerServerAdapter({
      type: adapterType, supportsLocalAgentJwt: false,
      execute: async input => {
        dispatched.add(input.runId);
        if (input.context.issueId) {
          await db.update(issues).set({ status: "in_review" }).where(eq(issues.id, String(input.context.issueId)));
        }
        return { exitCode: 0, signal: null, timedOut: false, resultJson: {} };
      },
      testEnvironment: async () => ({ adapterType, status: "pass", checks: [], testedAt: new Date().toISOString() }),
    });
  }, 60_000);

  afterAll(async () => {
    await heartbeat?.drainActiveRunExecutions();
    unregisterServerAdapter(adapterType);
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    if (oldHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = oldHome;
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function seed(outsideHours: ActivityOutsideHoursMode | null, now = outside) {
    clock = now;
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    const userId = `hours-user-${companyId}`;
    const activitySchedule: CompanyActivitySchedule | null = outsideHours && {
      enabled: true, timezone: "UTC", outsideHours, staggerMinutes: 10,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "04:00" }],
    };
    await db.insert(authUsers).values({ id: userId, name: "Hours user", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({ id: companyId, name: "Activity hours fixture", issuePrefix: `H${companyId.slice(0, 6)}`, activitySchedule });
    await db.insert(companyMemberships).values({ companyId, principalId: userId, principalType: "user", status: "active", membershipRole: "member" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Night agent", adapterType, status: "idle", adapterConfig: {},
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 3600 } } });
    await db.insert(issues).values({ id: issueId, companyId, title: "Work for tonight", status: "todo", assigneeAgentId: agentId, responsibleUserId: userId, issueNumber: 1 });
    return { companyId, agentId, issueId, userId };
  }

  type Fixture = Awaited<ReturnType<typeof seed>>;
  const task = (f: Fixture) => ({ payload: { issueId: f.issueId }, contextSnapshot: { issueId: f.issueId } });

  async function wake(f: Fixture, options: Parameters<typeof heartbeat.wakeup>[1]) {
    const run = await heartbeat.wakeup(f.agentId, options);
    expect(run).not.toBeNull();
    await heartbeat.drainActiveRunExecutions();
    const [finished] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    return finished;
  }

  const automatic = (f: Fixture) => wake(f, { source: "automation", triggerDetail: "system", reason: "issue_assigned", ...task(f) });
  const byPerson = (f: Fixture) => wake(f, {
    source: "automation", triggerDetail: "system", reason: "issue_commented",
    requestedByActorType: "user", requestedByActorId: f.userId, ...task(f),
  });
  const runNow = (f: Fixture) => wake(f, {
    source: "on_demand", triggerDetail: "manual", reason: "manual",
    requestedByActorType: "user", requestedByActorId: f.userId, manualUserWake: true, ...task(f),
  });

  it("holds automatic work until the next window opens and then starts it", async () => {
    const f = await seed("defer_automatic");
    const finished = await automatic(f);

    expect(dispatched.has(finished.id)).toBe(false);
    expect(finished).toMatchObject({
      status: "cancelled",
      errorCode: "activity_hours_wait",
      resultJson: {
        executionRecovery: { kind: "ai_connection_wait", providerWorkStarted: false },
        activityHoursWait: { opensAt: opensAt.toISOString(), timezone: "UTC", outsideHours: "defer_automatic" },
      },
    });
    const retry = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.agentId)))
      .find(run => run.status === "scheduled_retry");
    expect(retry).toMatchObject({ scheduledRetryReason: "ai_connection_pool_wait" });
    // The start is spread over the stagger period after the opening.
    expect(retry!.scheduledRetryAt!.getTime()).toBeGreaterThanOrEqual(opensAt.getTime());
    expect(retry!.scheduledRetryAt!.getTime()).toBeLessThan(opensAt.getTime() + 10 * 60_000);
    const events = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, finished.id));
    expect(events.some(event => event.message?.includes("activity hours"))).toBe(true);
    const [issue] = await db.select().from(issues).where(eq(issues.id, f.issueId));
    expect(issue.status).not.toBe("blocked");
    expect((await executionProjectionsForRuns(db, f.companyId, [retry!.id])).get(retry!.id)).toMatchObject({
      label: "Waiting for activity hours", phase: "retry_scheduled",
      nextAction: expect.stringContaining(retry!.scheduledRetryAt!.toISOString()),
    });

    // Nothing is dropped: the work starts once the window is open.
    expect((await heartbeat.promoteDueScheduledRetries(new Date(opensAt.getTime() - 60_000))).runIds).not.toContain(retry!.id);
    clock = inside;
    expect((await heartbeat.promoteDueScheduledRetries(new Date(retry!.scheduledRetryAt!.getTime() + 1))).runIds).toContain(retry!.id);
    await heartbeat.resumeQueuedRuns();
    await heartbeat.drainActiveRunExecutions();
    expect(dispatched.has(retry!.id)).toBe(true);
    const [resumed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, retry!.id));
    expect(resumed.status).toBe("succeeded");
  }, 60_000);

  it("starts automatic work inside a window and when no schedule is set", async () => {
    expect(dispatched.has((await automatic(await seed("defer_automatic", inside))).id)).toBe(true);
    expect(dispatched.has((await automatic(await seed(null))).id)).toBe(true);
  }, 60_000);

  it("starts work a person asked for when only automatic work waits", async () => {
    const finished = await byPerson(await seed("defer_automatic"));
    expect(dispatched.has(finished.id)).toBe(true);
  }, 60_000);

  it("holds everything except an explicit run when all work waits", async () => {
    const held = await byPerson(await seed("defer_all"));
    expect(dispatched.has(held.id)).toBe(false);
    expect(held).toMatchObject({ status: "cancelled", errorCode: "activity_hours_wait" });

    const started = await runNow(await seed("defer_all"));
    expect(dispatched.has(started.id)).toBe(true);
  }, 60_000);

  it("skips a periodic timer check without queueing a successor", async () => {
    const f = await seed("defer_automatic");
    const finished = await wake(f, { source: "timer", triggerDetail: "system", reason: "heartbeat_timer" });

    expect(dispatched.has(finished.id)).toBe(false);
    expect(finished).toMatchObject({ status: "cancelled", errorCode: "activity_hours_wait" });
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.agentId));
    expect(runs.filter(run => run.status === "scheduled_retry")).toHaveLength(0);
    const [agent] = await db.select().from(agents).where(eq(agents.id, f.agentId));
    expect(agent.status).toBe("idle");
  }, 60_000);
});
