import type { AcpRuntime, AcpSessionStore } from "acpx/runtime";

/**
 * To discard a session that has no live agent, ACPX starts a new agent process
 * and asks it to close the session. It starts that process without the session
 * environment. For a launch that cannot run without it (the packaged desktop
 * executable needs `ELECTRON_RUN_AS_NODE`), close without discarding and mark
 * the stored session for reset here, so that no process starts.
 */
export function discardWithoutRelaunch(runtime: AcpRuntime, sessionStore: AcpSessionStore): AcpRuntime {
  const close = runtime.close.bind(runtime);
  runtime.close = async (input) => {
    if (!input.discardPersistentState) return await close(input);
    await close({ ...input, discardPersistentState: false });
    const record = await sessionStore.load(input.handle.acpxRecordId ?? input.handle.sessionKey);
    if (!record) return;
    await sessionStore.save({ ...record, acpx: { ...record.acpx, reset_on_next_ensure: true } });
  };
  return runtime;
}
