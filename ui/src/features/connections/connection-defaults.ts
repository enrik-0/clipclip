import {
  getConnectableAppDefinition,
  isSuggestedAskFirstAction,
  recommendedDefaultsForApp,
  suggestedAskFirstReasons,
  type ConnectToolAppResult,
} from "@paperclipai/shared";

/**
 * Which of a fresh connection's actions start behind a human approval (PAP-659
 * C6a/C7).
 *
 * The runtime gate and its approval card already existed; what was missing was
 * a default with anything behind it. This lives outside the wizard because two
 * different setup paths commit connections — the catalog flow and the
 * remote-MCP gateway flow — and a gate that is armed on only one of them is a
 * gate you cannot reason about. The risk levels come from the server's
 * `suggestedDefaults` rather than a constant here, so retuning the policy stays
 * a one-line change in `recommendedDefaultsForApp`.
 */
export function askFirstCatalogEntryIdsFor(
  result: Pick<ConnectToolAppResult, "actions" | "suggestedDefaults">,
  isEnabled: (catalogEntryId: string) => boolean,
): string[] {
  // Risk levels gate whole tiers; `askFirstActions` names single actions, such
  // as Obsidian patch_note, with a reason the permissions step shows.
  // Gateway setups (Arcade, Composio) can finish without an action list.
  return (result.actions?.canMakeChanges ?? [])
    .filter((action) => isEnabled(action.catalogEntryId) && isSuggestedAskFirstAction(result.suggestedDefaults, action))
    .map((action) => action.catalogEntryId);
}

/**
 * Why the app's suggested defaults put single actions behind Ask first, keyed
 * by tool name, so the permissions step can say why (for example Obsidian
 * patch_note). Empty for apps without such a suggestion.
 */
export function askFirstReasonsForConnection(
  config: { sourceTemplateKey?: unknown; connectionMethodKey?: unknown } | null | undefined,
): Map<string, string> {
  const slug = typeof config?.sourceTemplateKey === "string" ? config.sourceTemplateKey : null;
  const app = slug ? getConnectableAppDefinition(slug) : null;
  if (!app) return new Map();
  const methodKey = typeof config?.connectionMethodKey === "string" ? config.connectionMethodKey : null;
  return suggestedAskFirstReasons(recommendedDefaultsForApp(app, methodKey));
}
