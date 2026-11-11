# Tasken

- `custom.tasken` connects Muse to Tasken, the user's app for work, plans and notes, through the HTTP JSON API of its replica on the user's NAS. It is reachable only inside the tailnet. It authenticates with the registered `api_key` credential and calls only the registered host.

- The helper is `~/workspace/custom-connectors/custom.tasken/bin/tasken.py`. It reads the host from `bin/host` (one line, `<name>:<port>`) or `TASKEN_HOST`. It covers every call below; there is no other entry point to learn.

## Connect

- The connection was registered with `credentials.request_api_access` and these details. Reuse them to reconnect (`api_hosts` is the host in `bin/host`):

```json
{
  "provider": "tasken",
  "auth_scheme": "api_key",
  "placement": "bearer_header",
  "api_hosts": ["<the host in bin/host>"]
}
```

- Before the first call in a conversation, prove access with a harmless read:

```text
python3 ~/workspace/custom-connectors/custom.tasken/bin/tasken.py describe
```

or, to read some data as well, `T call search_items '{"query":"実験"}'` (`T` is defined below).

- Reach the NAS through the runtime tunnel proxy. The helper reads `HTTPS_PROXY` and rewrites its port to 3130, and it fails loudly when the variable is missing.

## Credentials

- The registered connection holds the credential. The helper imports `/opt/muse/skills/custom-connector-setup/bin/dynamic_credentials.py`, which returns an `hsurr:` surrogate and places it where the provider reads the key. Muse swaps in the real credential only on an approved request to a registered host.

- Never put a key, token, password or cookie in this doc, a helper, a command argument, an environment variable or a log. Never ask the user to paste one in chat.

- Keep redirects disabled on authenticated requests.

- On a 401 or 403, check the request first. Confirm that the helper attached the credential, that the host is registered and that the placement matches. A 403 `tool_not_allowed` is not a credential problem: this client does not get that tool (see Errors). Only when a request that carried the credential is still answered 401, call `credentials.request_api_access` with the details above and `"reconnect": true`.

## The calls

Every read and every write goes through two commands (`T` = `python3 ~/workspace/custom-connectors/custom.tasken/bin/tasken.py`):

| Command                  | HTTP                  | What it does                                                                                                                              |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `T describe`             | `GET /api/v1`         | The tools this client can use now: `name`, `access` and the first line of the description, plus a `hash` of their names and input shapes. |
| `T describe <tool>`      | `GET /api/v1`         | One tool: its full description and `inputSchema` (the argument names, types and limits).                                                  |
| `T call <tool> '<json>'` | `POST /api/v1/<tool>` | Call one tool with a JSON object of arguments. Add `--dry-run` to validate without saving (only for tools whose schema has `dry_run`).    |

- Do not guess argument names. Read `T describe <tool>` before the first use of a tool in a conversation. A misspelled argument is refused with 400 `unknown_arguments` and nothing happens.
- The list is what this client may use right now. A tool that is not in it cannot be called (the helper stops before sending). Which tools appear depends on the NAS settings, so a tool you used before may be gone, and a `create_*` tool is present only when the user enabled it.
- `access` tells what a tool does: `read` only reads; `reading` saves something the user can read at once (a Feed post or reply); `proposal` saves a Proposal that waits for the user; `direct_write` creates an AI-made, unconfirmed Task or Note directly, or changes an existing Task (`change_task`, `undo_change`).
- Never put `caller` or `source_app` in the arguments. The server sets them from the credential.

### Which tool for which moment

| You want to                                | Tools                                                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find something                             | `search_items` (Tasks, waitings and plan nodes), `search_notes` (Notes)                                                                                                                                          |
| Know the present state                     | `list_open_items`, `get_theme_context`                                                                                                                                                                           |
| Read one thing                             | `get_task_context`, `get_note`                                                                                                                                                                                   |
| See what changed since last time           | `get_activity`: pass `page.next_cursor` from the last answer as `cursor`; when `page.status` says the cursor is invalid or a resync is required, read again without `cursor`                                     |
| Answer the user's question                 | `get_feed_context` to read the open questions, then `answer_feed_question`                                                                                                                                       |
| Leave something                            | `propose_feed_post` (a finding), `propose_note`, `propose_note_edit` (a change to an existing Note), `report_work` (what you did on a Task), and `create_task` / `create_note` only when `T describe` lists them |
| Change a Task the user asked you to change | `change_task` (update, complete, reopen, delete or delegate one Task) and `undo_change`, only when `T describe` lists them. Read `get_task_context` first                                                        |
| Check what you sent                        | `get_proposal_status`, `list_proposals`                                                                                                                                                                          |

```text
T describe search_items
T call search_items '{"query":"実験"}'
T call get_feed_context '{}'
T call get_activity '{}'
T call propose_feed_post '{"topic":"insight","body":["<a verified finding, one paragraph per item>"]}'
T call get_proposal_status '{"proposal_id":"<the proposal_id a write returned>"}'
```

Before the first `propose_feed_post` in a conversation, read `get_feed_context` and post only what is verified; separate facts from guesses. A post that is not worth the user's time is not posted.

## Freshness

The NAS holds a copy of the user's data. Its answers carry `source`:

- `as_of`: the time up to which the NAS has the Desktop's changes. Anything the user changed on the Desktop after that is not here yet.
- `state`: `ok` means the copy is following the Desktop. Anything else means it may be behind or cut off.
- `desktop_seen_at`: when the NAS last heard from the Desktop.

When `state` is not `ok`, or `as_of` is old for the question, say so to the user together with the time the NAS has the Desktop's changes up to ("NAS が持っているのは ○時までの Desktop の変更です"), and do not state the result as the present fact.

## What gets saved

- A Proposal (`propose_note`, `propose_note_edit`, `report_work`) is not data until the user adopts it on the Desktop. Report it as pending, with its Proposal ID, never as a saved Note or a done Task. A work report never completes a Task.
- A Feed post or reply (`propose_feed_post`, `answer_feed_question`) is readable by the user at once.
- `create_task` and `create_note`, when listed, create the item directly, marked as AI-made and unconfirmed. Say so.
- `change_task`, when listed, changes an existing Task at once, and the user sees it in Tasken's Activity with your words. Change only what the user asked for, and put the user's own words that asked for it in `said`, quoted as said. When the change is your own judgement, send `why` without `said`; if the answer is `ASK_USER`, nothing was saved: ask the user and send again with `said`.
  - Use one `source_session` for the whole conversation. After 30 Tasks in one conversation the server asks again; send `confirm_bulk: true` with `said` only after the user agrees.
  - A 409 `CONFLICT` carries `current_task`: the Task changed after you read it. Read it, decide again, and send the new `expected_version`.
  - Tasks under delegated work, recurring completions and Tasks in a sync conflict are refused. Report work on a delegated Task with `report_work`.
  - Every change can be undone with `undo_change`, by the `change_id` it returned or by `undo_session` for the whole conversation. When the user asks you to undo, put their words in `said`.
  - Tell the user what you changed, as done, with the `change_id`.
- There is no tool that edits an existing Note directly. A change to a Note goes through `propose_note_edit`.
- Never write a secret, key or password into anything you save.

## Retries

- For a write whose tool takes `idempotency_key`, the helper makes a key (or uses the one in your arguments or `--key`) and prints it as `idempotency_key`, also when the call failed.
- When the answer is lost (`http_status` 599 or a timeout), send the same command again with `--key <the printed key>` and the same arguments, or check with `get_proposal_status`. A resend with the same key and the same content returns the first result and saves nothing twice. Never retry with a new key, and never change the content under the same key (409 `IDEMPOTENCY_CONFLICT`).
- `--dry-run` with the same key and content shows what the real call will do. The real call then returns the same Proposal ID.

## Errors

The helper prints `http_status` with the server's `error`. A failure that happened before sending (a tool not listed, a bad `--key`) has no `http_status`, and nothing was sent.

- 400: `unknown_arguments` (a misspelled argument; the answer lists them), `idempotency_key_required`, `invalid_arguments` or `VALIDATION_FAILED` (a wrong value; read `T describe <tool>`).
- 403: `tool_not_allowed` (this client does not get that tool; do not look for a way around it), `WRITE_NOT_ALLOWED`.
- 404: `unknown_tool` or `NOT_FOUND` (the thing does not exist).
- 409: `IDEMPOTENCY_CONFLICT` (the key was used with different content), `STALE_VERSION` (the thing changed; read it again), and two states of the NAS that refuse writes but not reads:
  - `REPLICA_BEHIND`: the NAS has not caught up with the Desktop yet. Wait a little and send the same command again with the same key.
  - `DESKTOP_BEHIND`: the user's Desktop app is older than the NAS and could not take in what you would save. Waiting does not help: tell the user that writes wait until they update Tasken on the Desktop, and keep what you wanted to save to send later with the same key.
- 503: the NAS's Tasken does not answer. Tell the user; retry later with the same key.

## Shapes change

`T describe` prints a `hash` of the tool names and their input shapes. Keep the one you last saw. When it differs, read `T describe <tool>` again for every tool you are about to use before calling it.
