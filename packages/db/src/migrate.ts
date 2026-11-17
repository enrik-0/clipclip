import { applyPendingMigrations, inspectMigrations } from "./client.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main(): Promise<void> {
  const resolved = await resolveMigrationConnection();

  console.log(`Migrating database via ${resolved.source}`);

  try {
    const before = await inspectMigrations(resolved.connectionString);
    if (before.status === "upToDate") {
      console.log("No pending migrations");
      return;
    }

    console.log(`Applying ${before.pendingMigrations.length} pending migration(s)...`);
    await applyPendingMigrations(resolved.connectionString);

    const after = await inspectMigrations(resolved.connectionString);
    if (after.status !== "upToDate") {
      throw new Error(`Migrations incomplete: ${after.pendingMigrations.join(", ")}`);
    }
    console.log("Migrations complete");
  } finally {
    await resolved.stop();
  }
}

await main();

// A child process that outlives the embedded database (for example an orphaned
// worker inheriting its stdio pipes) can keep the event loop alive after every
// step has finished, which blocks `pnpm dev` and every script waiting on this
// command. The timer is unref'd: it never delays a normal exit, and the grace
// period lets buffered output flush before a forced one.
setTimeout(() => process.exit(0), 3_000).unref();
