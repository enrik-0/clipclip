# Obsidian and Notion as agent knowledge

Agents can read notes as a source of procedures and context, and write their
deliverables as notes. This page covers both note tools.

## Notion

Notion is already in the Apps catalog (`packages/shared/src/app-definitions/notion.json`).
It uses Notion's remote MCP server at `https://mcp.notion.com/mcp` with OAuth.
Open **Apps**, choose **Notion**, and connect. No setup in this repository is
needed.

## Obsidian

Obsidian has no cloud API. A vault is a folder of Markdown files on the
computer. Paperclip reaches it through an existing MCP server that reads the
folder directly: [`@bitbonsai/mcpvault`](https://github.com/bitbonsai/mcpvault).
Obsidian does not need to be open, and no Obsidian plugin is needed.

This works only when Paperclip runs on the computer that holds the vault.

### Why this server

| Server | Access | Verdict |
| --- | --- | --- |
| `@bitbonsai/mcpvault` | Vault folder | Chosen. Search, read, write, frontmatter and tag tools. `--read-only` mode. Skips `.obsidian/`, blocks path traversal and symlink escapes. MIT. |
| `obsidian-mcp` (StevenStavrakis) | Vault folder | Alternative. Stricter confinement and a trash with recovery, but no frontmatter tool and no read-only mode. It writes a `.obsidian-mcp/` folder in the vault. |
| `@modelcontextprotocol/server-filesystem` | Any folder | Last resort. Raw files only, no frontmatter or tags, does not skip `.obsidian/`. |
| `mcp-obsidian`, `obsidian-mcp-server` | Local REST API plugin | Not used. They need the plugin and Obsidian open. |
| Official Obsidian CLI | Running app | Not used. It needs the app running and exposes no MCP server. |

Checked on 2026-11-14 against version `0.18.3` (Node 22.12 or later).

### How it connects

Paperclip runs a local stdio MCP server only from an approved command template.
A board user registers a company template with the exact command, and a
`local_stdio` connection uses it. No Paperclip code changes.

The gateway starts the command without a shell, once for each tool call. For
that reason the template runs `node <entry file> <vault>` from a local install.
It does not run `npx`: on Windows `npx` cannot start without a shell, and it
would also reach the network on every call.

### Steps

1. Install the server in a folder outside the vault. Pin the version.

   ```sh
   npm install --prefix "C:\Users\me\.paperclip-notes\mcpvault" @bitbonsai/mcpvault@0.18.3
   ```

2. Check what the script will register. This sends nothing.

   ```sh
   node experiments/notes/connect-obsidian.mjs --dry-run \
     --vault "C:\Users\me\Notes" \
     --server-dir "C:\Users\me\.paperclip-notes\mcpvault"
   ```

3. Register the template and the connection.

   ```sh
   node experiments/notes/connect-obsidian.mjs \
     --company <companyId> \
     --vault "C:\Users\me\Notes" \
     --server-dir "C:\Users\me\.paperclip-notes\mcpvault"
   ```

   Add `--read-only` for a connection that cannot change notes. You can register
   both: a read-only connection for most agents and a writing one for the agents
   that file deliverables.

4. In **Apps**, open the connection and choose which agents can use which tools.
   A new connection gives no agent access by default.

5. Give those agents the `notes-knowledge-base` skill from the skills catalog.

### Tools

Read: `read_note`, `read_note_lines`, `read_multiple_notes`, `get_note_outline`,
`list_directory`, `search_notes`, `get_frontmatter`, `get_notes_info`,
`get_vault_stats`, `list_all_tags`, `wiki_link`.

Write: `write_note`, `patch_note`, `move_note`, `move_file`,
`update_frontmatter`, `manage_tags`.

Delete: `delete_note`. It deletes permanently by default. Require approval for
it, or leave it out of every agent's tools.

The script reads the tool list from the installed server, so the registered
tools match the installed version.

The script states each tool's permission tier. mcpvault does not mark its
writing tools, and Paperclip reads a tool with no hint as a read. Without the
explicit tier, `patch_note`, `move_note`, `move_file` and `manage_tags` would be
offered as harmless reads. A tool the script does not know is registered as a
write.

### Safety

- The vault path is fixed in the template. An agent cannot point the server at
  another folder.
- Use a folder, not a drive or share root. The script refuses a root. A root
  also breaks `patch_note`, `update_frontmatter` and the tag tools in
  `0.18.2` and later (mcpvault issue 281).
- Keep the vault in version control or a synced backup before agents write to it.
- A template is a command that Paperclip runs on the host. Only a board user
  with tools administration can create one, and creation is in the activity log.
- Local stdio connections are refused in an authenticated public deployment
  without a trusted runtime host.

### Not covered yet

- Creating tasks from notes and mirroring task status into notes. Agents can
  read and write notes; no sync runs on its own.
- A first-class catalog entry with its own setup screen. The script is the
  setup path.

### Verification status

Checked on 2026-11-14 on Windows 11, with `@bitbonsai/mcpvault@0.18.3` and a
vault in `C:\Users\<user>\Documents\Obsidian Vault` (a path with a space),
against an isolated local Paperclip instance:

- The script created the template and the connection. The connection was
  active and its health check passed.
- The catalog held 18 tools: 11 read, 6 write, 1 destructive.
- Test calls through the gateway worked for `get_vault_stats`, `read_note`,
  `write_note`, `update_frontmatter`, `patch_note`, `manage_tags` and
  `search_notes`.

Not checked: a call from a running agent, and `delete_note`, `move_note` and
`move_file`. The script's own catalog refresh call was added after this run; the
same endpoint was called by hand in it.
