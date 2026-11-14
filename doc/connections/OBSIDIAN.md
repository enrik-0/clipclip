# Obsidian and Notion as agent knowledge

Agents can read notes as a source of procedures and context, and write their
deliverables as notes. This page covers both note tools.

## Notion

Notion is in the Apps catalog (`packages/shared/src/app-definitions/notion.json`).
It uses Notion's remote MCP server at `https://mcp.notion.com/mcp` with OAuth.
Open **Connectors**, choose **Notion**, and connect.

## Obsidian

Obsidian has no cloud API. A vault is a folder of Markdown files on a computer.
Paperclip reaches it through an existing MCP server that reads the folder
directly: [`@bitbonsai/mcpvault`](https://github.com/bitbonsai/mcpvault), pinned
as a server dependency. Obsidian does not need to be open, and no Obsidian
plugin is needed.

This works only when Paperclip runs on the computer that holds the vault.

### Set up a vault

1. Open **Connectors** and choose **Obsidian**.
2. Enter the **Vault folder**: the full path of the vault on the computer that
   runs Paperclip. In Obsidian, the vault switcher shows it.
3. Optional: under the advanced options, turn on **Read only**. Agents can then
   search and read notes but cannot change them.
4. Connect. Paperclip checks that the folder exists.
5. Choose which tools are allowed, which need approval, and which agents can use
   the connection. Until this step is done, no agent has any of the tools.

Repeat the steps for each vault. One company can connect several vaults, each
with its own name, folder and permissions. A common setup is a read-only
connection to a shared procedures vault and a writing connection to a vault for
deliverables.

Give the agents the `notes-knowledge-base` skill from the skills catalog. The
guidance on how to use the notes lives in that skill: looking up procedures,
filing deliverables, and keeping memory. The connector's own agent instructions
only point to it. Turning notes into tasks and mirroring task status is not
part of that skill; it would be a separate one.

### Why this server

| Server | Access | Verdict |
| --- | --- | --- |
| `@bitbonsai/mcpvault` | Vault folder | Chosen. Search, read, write, frontmatter and tag tools. `--read-only` mode. Skips `.obsidian/`, blocks path traversal and symlink escapes. MIT. |
| `obsidian-mcp` (StevenStavrakis) | Vault folder | Alternative. Stricter confinement and a trash with recovery, but no frontmatter tool and no read-only mode. It writes a `.obsidian-mcp/` folder in the vault. |
| `@modelcontextprotocol/server-filesystem` | Any folder | Last resort. Raw files only, no frontmatter or tags, does not skip `.obsidian/`. |
| `mcp-obsidian`, `obsidian-mcp-server` | Local REST API plugin | Not used. They need the plugin and Obsidian open. |
| Official Obsidian CLI | Running app | Not used. It needs the app running and exposes no MCP server. |

Checked on 2026-11-14 against version `0.18.3` (Node 22.12 or later).

### Tools

Read: `read_note`, `read_note_lines`, `read_multiple_notes`, `get_note_outline`,
`list_directory`, `search_notes`, `get_frontmatter`, `get_notes_info`,
`get_vault_stats`, `list_all_tags`, `wiki_link`.

Write: `write_note`, `patch_note`, `move_note`, `move_file`,
`update_frontmatter`, `manage_tags`.

Delete: `delete_note`. It deletes permanently by default. Require approval for
it, or leave it out of every agent's tools.

A read-only connection offers only the read tools.

### How it works

- `packages/shared/src/app-definitions/obsidian.json` is the catalog entry. Its
  source is `scripts/app-definition-overrides/obsidian.json`. The vault folder
  and the read-only choice are connection settings, not credentials.
- `server/src/services/obsidian-connection.ts` owns the provider logic: it
  checks the vault folder and builds the command for one connection.
- `server/src/services/obsidian-vault-tools.generated.ts` holds the tool list of
  the pinned server version, with the permission tier of each tool. The server
  marks no tool as read-only or destructive, and Paperclip reads an unmarked
  tool as a read, so the tier is stated there. Regenerate the file when the
  pinned version changes.
- The tool gateway starts `node <server entry> <vault folder>` for each call,
  without a shell. `npx` is not used: it cannot start without a shell on
  Windows, and it would reach the network on every call.

### Safety

- The vault folder is a connection setting. An agent cannot point the server at
  another folder.
- A drive or share root is refused. A root exposes far more than notes, and it
  breaks `patch_note`, `update_frontmatter` and the tag tools in `0.18.2` and
  later (mcpvault issue 281).
- Keep the vault in version control or a synced backup before agents write to it.
- Local stdio connections are refused in an authenticated public deployment
  without a trusted runtime host.

### Not covered yet

- Creating tasks from notes and mirroring task status into notes. Agents can
  read and write notes; no sync runs on its own.
- Editing the vault folder of an existing connection. Remove the connection and
  add it again.

### Verification status

Checked on 2026-11-14 on Windows 11 against an isolated local Paperclip instance:

- The catalog connect endpoint created two Obsidian connections in one company,
  one of them read only. A folder that does not exist was refused with a clear
  message.
- The writing connection listed 18 tools: 11 read, 6 write, 1 destructive. The
  read-only connection listed the 11 read tools.
- After the permissions step, test calls through the gateway searched and read
  notes in the read-only vault, and it had no `write_note` tool.
- An earlier run on a real vault, in a path with a space, also exercised
  `write_note`, `update_frontmatter`, `patch_note` and `manage_tags`.

Not checked: the setup form in a browser, a call from a running agent, and
`delete_note`, `move_note` and `move_file`.
