/** Room for the grant suffix inside the server's 160-character name limit. */
const MAX_FOLDER_NAME_LENGTH = 80;

/** The last folder of a local path, or null for an empty path or a drive root. */
function folderName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const last = value.trim().split(/[\\/]+/).filter(Boolean).at(-1);
  if (!last || /^[A-Za-z]:$/.test(last)) return null;
  return last.slice(0, MAX_FOLDER_NAME_LENGTH).trim() || null;
}

/**
 * The name a new catalog connection gets when nobody typed one. An Obsidian
 * company can connect several vaults, so its name adds the vault folder;
 * otherwise every vault would be "Obsidian" and the list could not tell them
 * apart.
 */
export function defaultGalleryConnectionName(
  app: { slug: string; name: string },
  configValues: Record<string, unknown>,
): string {
  if (app.slug !== "obsidian") return app.name;
  const folder = folderName(configValues.vaultPath);
  return folder ? `${app.name} (${folder})` : app.name;
}
