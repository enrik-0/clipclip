import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, companies, companyMemberships, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { toolAccessService } from "../services/tool-access.js";

const support = await getEmbeddedPostgresTestSupport();
const actor = { actorType: "user" as const, actorId: "board-user" };

(support.supported ? describe : describe.skip)("Obsidian connection setup errors", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const parent = mkdtempSync(path.join(tmpdir(), "paperclip-obsidian-setup-"));

  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("paperclip-obsidian-setup-");
    db = createDb(temp.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await temp?.cleanup();
    rmSync(parent, { recursive: true, force: true });
  });

  async function createCompany() {
    const [company] = await db
      .insert(companies)
      .values({ name: `Obsidian ${randomUUID()}`, issuePrefix: `OB${randomUUID().slice(0, 6).toUpperCase()}` })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company!.id,
      principalType: "user",
      principalId: actor.actorId,
      status: "active",
      membershipRole: "admin",
    });
    return company!;
  }

  async function connectVault(vaultPath: string) {
    const company = await createCompany();
    return toolAccessService(db).connectGalleryApp(
      company.id,
      { galleryKey: "obsidian", connectionMethodKey: "vault", configValues: { vaultPath } },
      actor,
    );
  }

  it("returns 422 with the original message and code for a folder that does not exist", async () => {
    await expect(connectVault(path.join(parent, "missing vault"))).rejects.toMatchObject({
      status: 422,
      message: "Paperclip cannot find that folder on the computer that runs it. Check the path of the vault.",
      details: { code: "obsidian_vault_path_not_found" },
    });
  });

  it("returns 422 with the original message and code for a drive root", async () => {
    await expect(connectVault(path.parse(parent).root)).rejects.toMatchObject({
      status: 422,
      message: "The vault cannot be a drive or share root. Choose the vault's own folder.",
      details: { code: "obsidian_vault_path_root" },
    });
  });
});
