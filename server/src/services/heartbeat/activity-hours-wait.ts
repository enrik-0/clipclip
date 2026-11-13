import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, agentWakeupRequests, companies, heartbeatRuns } from "@paperclipai/db";
import {
  activityHoursStaggerMs,
  isWithinActivityHours,
  nextActivityHoursStart,
  parseCompanyActivitySchedule,
  type CompanyActivitySchedule,
} from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";
import { AI_CONNECTION_POOL_WAIT_RETRY_REASON } from "../../modules/run-dispatch/index.js";
import { parseObject } from "../../adapters/utils.js";

type HeartbeatRun = typeof heartbeatRuns.$inferSelect;
type Agent = typeof agents.$inferSelect;

export const ACTIVITY_HOURS_WAIT_ERROR_CODE = "activity_hours_wait";
export const ACTIVITY_HOURS_RETRY_WAKE_REASON = "activity_hours_retry";

export interface ActivityHoursWaitDependencies {
  setRunStatusIfRunning: (runId: string, status: "cancelled", patch: {
    error: string; errorCode: string; finishedAt: Date; resultJson: Record<string, unknown>;
  }) => Promise<{ updated: boolean; run?: HeartbeatRun | null }>;
  setWakeupStatus: (wakeupRequestId: string | null | undefined, status: "cancelled", patch: { finishedAt: Date; error: string }) => Promise<unknown>;
  appendRunEvent: (run: HeartbeatRun, event: {
    eventType: string; stream: "system"; level: "info" | "warn"; message: string; payload: Record<string, unknown>;
  }) => Promise<unknown>;
  scheduleBoundedRetryForRun: (run: HeartbeatRun, agent: Agent, opts: {
    now: Date; retryReason: string; wakeReason: string; maxAttempts: number; delayMs: number;
  }) => Promise<{ outcome: string }>;
  releaseIssueExecutionAndPromote: (run: HeartbeatRun) => Promise<unknown>;
  finalizeAgentStatus: (agentId: string, outcome: "cancelled") => Promise<unknown>;
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => Date;
}

/** Holds work that would start outside the company's activity hours. */
export function createActivityHoursWait(db: Db, deps: ActivityHoursWaitDependencies) {
  const {
    setRunStatusIfRunning, setWakeupStatus, appendRunEvent, scheduleBoundedRetryForRun,
    releaseIssueExecutionAndPromote, finalizeAgentStatus,
  } = deps;

  async function readSchedule(companyId: string): Promise<CompanyActivitySchedule | null> {
    const row = await db.select({ activitySchedule: companies.activitySchedule }).from(companies)
      .where(eq(companies.id, companyId)).then((rows) => rows[0] ?? null);
    return parseCompanyActivitySchedule(row?.activitySchedule);
  }

  /**
   * A person who starts work means it to start now. `defer_automatic` lets
   * every wake a person asked for through; `defer_all` only an explicit run.
   */
  async function startedByPerson(run: HeartbeatRun, schedule: CompanyActivitySchedule): Promise<boolean> {
    if (!run.wakeupRequestId) return false;
    const wake = await db.select({
      requestedByActorType: agentWakeupRequests.requestedByActorType, payload: agentWakeupRequests.payload,
    }).from(agentWakeupRequests)
      .where(and(eq(agentWakeupRequests.id, run.wakeupRequestId), eq(agentWakeupRequests.companyId, run.companyId)))
      .then((rows) => rows[0] ?? null);
    if (wake?.requestedByActorType !== "user") return false;
    return schedule.outsideHours === "defer_automatic" || parseObject(wake.payload).manualUserWake === true;
  }

  /**
   * Before any workspace or provider work, hold a wake that falls outside the
   * company's activity hours and start it when the next window opens. A
   * recovering run and a conversation turn still start: the first already
   * holds its work, the second answers a person who is waiting. A run that is
   * already executing is never stopped here.
   */
  async function deferRunOutsideActivityHours(
    run: HeartbeatRun,
    agent: Agent,
    options: { resumingAdmittedRun: boolean; conversation: boolean },
  ): Promise<boolean> {
    if (options.resumingAdmittedRun || options.conversation) return false;
    const now = deps.now?.() ?? new Date();
    let schedule: CompanyActivitySchedule | null;
    let exempt: boolean;
    try {
      schedule = await readSchedule(run.companyId);
      if (!schedule || isWithinActivityHours(schedule, now)) return false;
      exempt = await startedByPerson(run, schedule);
    } catch (err) {
      // A schedule that cannot be read must not stop work.
      logger.warn({ err, runId: run.id }, "activity hours unavailable before dispatch");
      return false;
    }
    if (exempt) return false;
    const opensAt = nextActivityHoursStart(schedule, now);
    // A schedule with no reachable window would hold work forever; let it run.
    if (!opensAt) return false;

    // A timer tick only looks for work. The next tick inside a window does the
    // same, so a held tick needs no successor.
    const periodicCheck = run.invocationSource === "timer";
    const startAt = new Date(opensAt.getTime() + activityHoursStaggerMs(schedule, run.id));
    const startAtIso = startAt.toISOString();
    const message = periodicCheck
      ? `Outside the company's activity hours. The next window opens at ${opensAt.toISOString()}; this periodic check was skipped.`
      : `Outside the company's activity hours. Paperclip will start this work at ${startAtIso}.`;
    const cancelled = await setRunStatusIfRunning(run.id, "cancelled", {
      error: message, errorCode: ACTIVITY_HOURS_WAIT_ERROR_CODE, finishedAt: now,
      resultJson: {
        executionRecovery: { kind: "ai_connection_wait", providerWorkStarted: false },
        activityHoursWait: {
          opensAt: opensAt.toISOString(), startAt: periodicCheck ? null : startAtIso,
          timezone: schedule.timezone, outsideHours: schedule.outsideHours, actionUrl: "/company/settings",
        },
        cancellation: {
          source: "control_plane", expected: true, initiator: { type: "system" },
          reason: "Waiting for the company's activity hours", recordedAt: now.toISOString(),
        },
        ...(periodicCheck ? {} : { retryAt: startAtIso }),
      },
    });
    if (!cancelled.updated) return true;
    const deferred = cancelled.run ?? run;
    // The cancellation is committed. From here the wake must either gain its
    // retry or release its task lock; diagnostics never decide that.
    let scheduled = false;
    try {
      // Scheduling is idempotent per source run, so one more attempt is safe.
      for (let attempt = 1; !periodicCheck && attempt <= 2 && !scheduled; attempt += 1) {
        try {
          const retry = await scheduleBoundedRetryForRun(deferred, agent, {
            now, retryReason: AI_CONNECTION_POOL_WAIT_RETRY_REASON, wakeReason: ACTIVITY_HOURS_RETRY_WAKE_REASON,
            // Waiting for a window is not a failure; each wait is one retry at the opening.
            maxAttempts: (run.scheduledRetryAttempt ?? 0) + 1,
            delayMs: Math.max(1000, startAt.getTime() - now.getTime()),
          });
          scheduled = retry.outcome === "scheduled";
          if (!scheduled) break;
        } catch (err) {
          logger.warn({ err, runId: run.id, attempt }, "failed to schedule the activity hours retry");
        }
      }
      await appendRunEvent(deferred, {
        eventType: "lifecycle", stream: "system", level: periodicCheck || scheduled ? "info" : "warn",
        message: periodicCheck
          ? "Skipped a periodic check outside the company's activity hours"
          : scheduled
            ? `Waiting for the company's activity hours; this work starts at ${startAtIso}`
            : `The company's activity hours open at ${opensAt.toISOString()}; this wake could not schedule its retry and released the task`,
        payload: { opensAt: opensAt.toISOString(), startAt: periodicCheck ? null : startAtIso, retryScheduled: scheduled },
      }).catch((err: unknown) => logger.warn({ err, runId: run.id }, "failed to record the activity hours wait"));
      await setWakeupStatus(run.wakeupRequestId, "cancelled", { finishedAt: now, error: message })
        .catch((err: unknown) => logger.warn({ err, runId: run.id }, "failed to settle the activity hours wakeup"));
    } finally {
      try {
        if (!scheduled) await releaseIssueExecutionAndPromote(deferred);
      } finally {
        await finalizeAgentStatus(run.agentId, "cancelled");
      }
    }
    return true;
  }

  return { deferRunOutsideActivityHours };
}
