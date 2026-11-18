# 0002: Obsidian connect screen: wrong name on completion, Read only hard to find

- Status: open
- Area: ui (`features/connections/ConnectionSetupFlow.tsx`)
- Type: bug
- Priority: low
- Found in: develop @ 73c57431e9

## Summary

Two small problems in the Obsidian setup flow found while testing it in a browser.

## Observed

1. **Wrong name on the completion screen. Confirmed.** A company already had a
   connection named "Vault pruebas". Adding a second one ended on a screen titled
   "Vault pruebas is ready." The connection that was just created is named
   "Obsidian for the organization" (it is the one that opens from **View
   connection**). The completion title showed the name of the other connection.
2. **Read only is hidden. Confirmed.** `doc/connections/OBSIDIAN.md` says "under
   the advanced options, turn on Read only". In the form the switch only appears
   after pressing **Change** next to "No sign-in needed, available to all
   agents." Nothing on the form says that is where the option is.
3. **Hypothesis, not verified:** the form has no way to name the connection. The
   default name ("Obsidian for the organization") is the same for every vault,
   which makes several vaults hard to tell apart.

## Reproduce

1. Connect one Obsidian vault and name it through any available path.
2. **Add account** again with a different folder and press **Connect**.
3. Read the title on the completion screen, then open **View connection**.

## Where to look

- `ui/src/features/connections/ConnectionSetupFlow.tsx`: the completion stage
  (`stage=complete`) and the `advancedConfigFields` / `renderDefaults` block
  (around lines 3797-3917).

## Expected

- The completion screen names the connection that was just created.
- The Read only switch is discoverable, for example by labelling the "Change"
  area or showing the choice summary ("Read and write" / "Read only") on the
  form.
- The user can name the connection, or the default name includes the vault folder.

## Acceptance criteria

- A UI test for the completion title with two connections of the same app.
- A UI test that the read-only choice is reachable and its current value is
  visible without opening the "Change" section (or the docs are changed to
  match the real path, if that is the decision).

## Out of scope

The permissions step and the tool list.
