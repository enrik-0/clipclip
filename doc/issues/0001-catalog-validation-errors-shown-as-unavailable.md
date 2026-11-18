# 0001: Setup validation errors are shown as "Paperclip is temporarily unavailable"

- Status: open
- Area: server (`tool-access`), ui (`api/errors.ts`)
- Type: bug
- Priority: high
- Found in: develop @ 73c57431e9

## Summary

When a connector setup fails because of something the user typed, the server
returns a precise message, but with HTTP 502. The UI treats every 502 as a
transient outage and replaces the message with "Paperclip is temporarily
unavailable. Please try again in a moment." The user cannot tell that the
folder path they entered is wrong, and a retry can never succeed.

## Observed

**Confirmed** with the Obsidian connector (`POST /api/companies/:companyId/tools/apps/connect`):

| Input (`vaultPath`) | HTTP | Body message |
| --- | --- | --- |
| `C:\esta\carpeta\no\existe` | 502 | `Paperclip cannot find that folder on the computer that runs it. Check the path of the vault.` |
| `C:\` | 502 | `The vault cannot be a drive or share root. Choose the vault's own folder.` |

Both responses have `"code": "paperclip_error"`. In the browser the same action
shows the red banner and toast "Paperclip is temporarily unavailable. Please try
again in a moment." (The same request sent directly to the API returns the 502
above, which is the only status the UI can have mapped to that wording.)

## Reproduce

1. Start the app, open **Connectors**, choose **Obsidian**, **Add account**.
2. Enter a folder that does not exist and press **Connect**.

## Where to look

- `server/src/services/tool-access/catalog/discovery.ts:465`: the Obsidian
  vault check throws `badRequest(error.message, { code: error.code })`, that is
  a 4xx with a specific code (`obsidian_vault_path_*`).
- `server/src/services/tool-access/catalog/failures.ts:143`: the failure is
  reduced to `{ status: "error", code: "paperclip_error" }`, which drops the
  original status and code.
- `server/src/services/tool-access/catalog/failures.ts:23-40`
  (`healthFailureHttpStatus`): known codes map to 422, everything else to 502.
- `ui/src/api/errors.ts:40-65,122`: 502 is in `TRANSIENT_STATUSES` and
  `CONNECTIVITY_STATUSES`, and `UNAVAILABLE_BODY` replaces the server message.

## Expected

A failure caused by user input returns a 4xx (422 is already used for this) with
the original message and code, and the UI shows that message. A real outage
(network, upstream down) keeps the 502 and the generic wording.

## Acceptance criteria

- A server test: connecting Obsidian with a missing folder and with a drive root
  returns 422 (or the existing 4xx convention), the specific code, and the
  message above.
- A test that a genuine upstream failure still returns 502.
- A UI test: a 422 setup error shows the server message, not
  `UNAVAILABLE_BODY`.
- Check that other connectors that reach `paperclip_error` for user mistakes
  are covered by the same change, or list the ones that are not.

## Out of scope

Redesigning the error banners.
