# 0005: `patch_note` can remove content without asking

- Status: open
- Area: server (Obsidian connector tool tiers)
- Type: decision
- Priority: medium
- Found in: develop @ 73c57431e9

## Summary

For the Obsidian connector, `delete_note` is high risk (two approvals today, see
0003) and `move_note` / `move_file` are `write` (one approval when set to "Ask
first"). `patch_note`, `write_note`, `update_frontmatter` and `manage_tags` are
also `write`. `patch_note` can delete content: replacing text with nothing is
how an agent removes a section. That removes information as surely as deleting
the note, and nothing observed keeps a copy of the old text (delete sends the
note to a `.trash/` folder; an edit does not).

## Observed

**Confirmed.** With `delete_note`, `move_note` and `move_file` set to "Ask
first" and everything else allowed, an OpenCode agent was told "that thing about
Monday's meeting is no longer needed, remove it from my notes". The note mixed
several topics. The agent used `patch_note` and removed only the Monday section.
No approval was requested. The result was right here, but nothing in the policy
would have stopped it from removing the wrong section.

**Not verified:** whether a bad `patch_note` could be recovered (the vault server
keeps no history of edits; the user's vault may be under version control).

## Where to look

- `server/src/services/obsidian-vault-tools.generated.ts`: tool list and tier of
  each tool (the server does not mark tools read-only or destructive, so the tier
  is stated there).
- `doc/connections/OBSIDIAN.md`, "Tools" and "Safety".

## Decision needed

Pick one and write it down:

1. Leave it as is and document that `patch_note` edits are not gated, and that
   the owner should keep the vault under version control.
2. Make "Ask first" the suggested default for `patch_note` in the setup step.
3. Classify `patch_note` calls that remove text (empty replacement, or a large
   shrink) as high risk.

## Acceptance criteria

- The decision is recorded in `doc/connections/OBSIDIAN.md`.
- If option 2 or 3: a test of the default or of the classification, and the
  permissions step shows the reason.

## Out of scope

The two step flow (0003).
