# Feed surface — six-product screen comparison (evidence-based)

Markers: **V** = verified from a primary source I fetched in this session · **S** = secondary source, named · **?** = not verified.

Limitation up front: official screenshots could not be opened. Direct HTTPS download from the shell is blocked in this sandbox (`SSL connection could not be established` for every image host), so `read_image` was impossible and **no axis below is filled from looking at a screenshot**. Claims about images are limited to official alt text/captions included in the page HTML.

---

## 1. X (Twitter) — mobile home timeline

**Fetched (primary):** [help.x.com/en/using-x/x-timeline](https://help.x.com/en/using-x/x-timeline) (200 — describes the timeline, partially) · [help.x.com/en/using-x/bookmarks](https://help.x.com/en/using-x/bookmarks) (200 — bookmark flow only).
**Not retrieved:** `help.x.com/en/using-x/twitter-timeline-settings` (403, bot wall), `help.x.com/en/using-x/x-notifications` (404). No official X page describing the post action bar, swipe behaviour, or "caught up" state was found.
**Secondary, body not retrievable (title/snippet only):** idownloadblog.com (2024‑11‑28), iphoneincanada.ca (2024‑11‑22), socialmediatoday.com — all report that X added _customizable swipe gestures_ (e.g. like/reply) to the iOS timeline in Nov 2024. I could not read the article bodies, so this is weak.

What the fetched pages actually confirm: For you vs Following tabs (swipe between them); tapping the post-text area opens the **post detail page**; promoted posts and Reposts appear inline; replies in a conversation are not always chronological; "Happening now" events can sit at the top and can be **hidden** via a "why you're seeing this" tap; Bookmarks are saved from post detail (iOS) or the share menu (web/Android).

| Axis                  | Finding                                                                                                                                                                     | Conf              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Item anatomy          | ?                                                                                                                                                                           | ?                 |
| Actor representation  | ?                                                                                                                                                                           | ?                 |
| Information density   | ?                                                                                                                                                                           | ?                 |
| Action count per row  | ?                                                                                                                                                                           | ?                 |
| Open/detail behaviour | Tapping post text → post detail page (leaves the list)                                                                                                                      | V                 |
| Reply from list       | ?                                                                                                                                                                           | ?                 |
| Snooze / dismiss      | Bookmarks = save-for-later (not snooze). "Happening now" card can be hidden from the timeline. No feed-level snooze documented                                              | V (partial)       |
| Ranking / ordering    | For you = followed accounts + recommended posts/topics; Following = followed accounts only; both explained in help. Reply ranking is explicitly stated as non-chronological | V                 |
| Read/unread state     | ?                                                                                                                                                                           | ?                 |
| Mobile gesture        | Customizable swipe (like/reply) on iOS timeline                                                                                                                             | S (bodies unread) |
| End-of-feed           | ?                                                                                                                                                                           | ?                 |

## 2. Ambra (ambra.app)

**Fetched:** [ambra.app](https://ambra.app/) (200, marketing landing page) · [apps.apple.com/us/app/ambra-app/id1617982829](https://apps.apple.com/us/app/ambra-app/id1617982829) (200, App Store vendor copy) · [ambraapp.tawk.help](https://ambraapp.tawk.help/) (200 but renders no article text; `/sitemap.xml` 404).
**Verdict: no documentation of the actual screen was retrievable.** Both fetched pages are marketing/vendor copy. The "twitter-like, one-box" claim on the landing page refers to the **single task-creation input box** (natural language + `@mention` + `#tags`), not to the feed itself. Screenshot files (`ambra-timeline.png`, `ambra-social-like.png`, `ambra-task-dashboard.png`) are referenced but could not be downloaded or inspected.

Vendor copy does assert, about the Timeline view (the default project view): tasks listed in chronological order, newest on top; click anywhere in a task description to start editing; click a tag or a team member (even inside a task) to filter the list; drag-and-drop to change priority; a search box filters by tag, member or keyword; and the App Store copy says `@mention` assigns a task. Those are the only row-level facts available, and they come from marketing text.

| Axis                  | Finding                                                                           | Conf            |
| --------------------- | --------------------------------------------------------------------------------- | --------------- |
| Item anatomy          | Task description body, inline `@mention` assignee, `#tags`; per-row order unknown | S (vendor copy) |
| Actor representation  | Assignee shown as an `@mention` inside the task text                              | S (vendor copy) |
| Information density   | ?                                                                                 | ?               |
| Action count per row  | ?                                                                                 | ?               |
| Open/detail behaviour | Click into the description edits inline (no separate detail page documented)      | S (vendor copy) |
| Reply from list       | ? (no comment/reply concept documented)                                           | ?               |
| Snooze / dismiss      | ?                                                                                 | ?               |
| Ranking / ordering    | Timeline = chronological, newest on top; Kanban/Insights are alternate views      | S (vendor copy) |
| Read/unread state     | ?                                                                                 | ?               |
| Mobile gesture        | Drag-and-drop for priority (pointer); no swipe/long-press documented              | S (partial)     |
| End-of-feed           | ?                                                                                 | ?               |

## 3. Linear Pulse

**Fetched (primary, all 200 and all describing the feature):** [linear.app/docs/pulse](https://linear.app/docs/pulse) · [linear.app/changelog/2025-11-13-pulse-on-mobile](https://linear.app/changelog/2025-11-13-pulse-on-mobile) · [linear.app/docs/inbox](https://linear.app/docs/inbox) (adjacent surface, used only where flagged) · [linear.app/mobile](https://linear.app/mobile) (marketing only — contributes nothing).

Alt text on the official images: "The main Pulse feed, and a daily summary notification of Pulse in Inbox"; "A project update in Pulse"; "example daily pulse"; "A photo of the Pulse feed in the Linear mobile app".

Confirmed: Pulse is a sidebar feed of project/initiative updates **plus** daily/weekly summary notifications delivered to Inbox; three tabs — _For me_ (projects you're part of or may be interested in), _Popular_ (recent updates with emoji/comment engagement), _Recent_ (every update by recency); custom personal feeds built from saved filters; per-sidebar-item display mode "always / only when badged / never"; audio playback of Inbox summaries; on mobile the same three tabs plus "Leave a comment on any update, or react with an emoji". Inbox (separate doc) documents list navigation with J/K, click-into a dedicated Inbox view, `U` read/unread, `H` snooze, `Backspace` delete, display options "show snoozed" / "show unread first".

| Axis                  | Finding                                                                                                                              | Conf                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Item anatomy          | A project/initiative update rendered in full ("read full updates as written"); field order not documented                            | V (partial)               |
| Actor representation  | ? (author of the update is not described in the docs text)                                                                           | ?                         |
| Information density   | ? (updates are shown as full text, not one-line rows — implies low density)                                                          | V (partial)               |
| Action count per row  | 2 actions documented on mobile: comment, emoji react                                                                                 | V                         |
| Open/detail behaviour | Sidebar feed reads updates in place; Inbox notifications open a dedicated Inbox view of the issue (push)                             | V                         |
| Reply from list       | Yes on mobile — comment on any update without leaving the feed                                                                       | V                         |
| Snooze / dismiss      | Not documented for Pulse. Inbox (adjacent) has snooze `H` and delete                                                                 | V (adjacent surface only) |
| Ranking / ordering    | Three named tabs, each explained to the user (For me / Popular / Recent)                                                             | V                         |
| Read/unread state     | Sidebar item can be set to appear "only when badged" → badge exists. Read/unread semantics for Pulse items themselves not documented | V (partial)               |
| Mobile gesture        | ?                                                                                                                                    | ?                         |
| End-of-feed           | ?                                                                                                                                    | ?                         |

## 4. Asana Inbox

Current `help.asana.com` **cannot be retrieved** (JS-only app: `/s/article/inbox` 404, `/hc/en-us/articles/14077826142875-Inbox` 401, `/s/?language=en_US` returns an empty shell; `asana.com/guide/...` cross-origin-redirects into it). What I fetched instead are **archived snapshots of Asana's own help articles** (Wayback Machine), which is vendor documentation but possibly stale (2023–2024):

- [Inbox (2023‑09‑21)](https://web.archive.org/web/20230921125337/https://help.asana.com/hc/en-us/articles/14077826142875-Inbox) — desktop Inbox screen in detail.
- [Stay informed with your Asana Inbox (2024‑05‑23)](https://web.archive.org/web/20240523120400/https://help.asana.com/hc/en-us/articles/14250971415195-Stay-informed-with-your-Asana-Inbox).
- [Inbox on Android (2024‑06‑18)](https://web.archive.org/web/20240618110020/https://help.asana.com/hc/en-us/articles/23288799244955-Inbox-on-Android) — the Android article the issue names. Image alt: "Inbox overview".
- [asana.com/features/project-management/inbox](https://asana.com/features/project-management/inbox) — marketing, no readable content.

Confirmed: clicking a notification opens the **task details pane on the right, "always open"**; the _latest_ notification is first; hovering a row reveals three actions — **Create a follow-up task**, **Mark as unread**, **Archive notification**; threads can be compressed/expanded for scannability; tabs _Activity_ and _Archive_ (archive clears itself after 4 weeks, "Move to Inbox" restores); **Archive all** from the three-dot menu _or_ by scrolling to the end of the inbox; filters All / Assigned to me / @Mentioned / Assigned by me, plus From Person and Unread only; **sort by Newest First or Relevance**; blue dot = new notification, orange dot next to sidebar Inbox = unread, a bubble = count of new comments/attachments; you can reply and add appreciation stickers from the inbox; Android: swipe left on a notification → **More** → Create follow-up task / Mark as unread / Archive, plus "Expand all" and the same filters, and a three-dot overflow.

| Axis                  | Finding                                                                                                                          | Conf                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Item anatomy          | Author/actor, task context and update text, new-comment/attachment count bubble, blue unread dot; exact order not stated         | V (partial, archived) |
| Actor representation  | The person who acted is named in the notification; avatar not documented in text                                                 | V (partial, archived) |
| Information density   | Expand vs condensed view toggle; compressed/expanded threads "for greater scannability"                                          | V (archived)          |
| Action count per row  | 3 hover actions (follow-up task, mark as unread, archive); 3 in the Android swipe-left "More" sheet                              | V (archived)          |
| Open/detail behaviour | Overlay/persistent right-hand task details pane, not a push; project name click loads the project in the main pane               | V (archived)          |
| Reply from list       | Yes — reply, thumbs-up/thanks, appreciation stickers straight from the inbox                                                     | V (archived)          |
| Snooze / dismiss      | **No snooze**; dismissal = Archive (row hover on desktop, swipe-left → More on Android), plus Archive all at end of list         | V (archived)          |
| Ranking / ordering    | Newest First or Relevance, user-selectable and named in UI                                                                       | V (archived)          |
| Read/unread state     | Explicit: blue dot per new notification, orange dot on sidebar Inbox, "Unread only" filter, and mark read/unread without opening | V (archived)          |
| Mobile gesture        | Swipe left reveals More (Create follow-up task / Mark as unread / Archive); no destructive-only gesture documented               | V (archived)          |
| End-of-feed           | No "caught up" state documented; the **end of the list is actionable** — scroll to the end and click "Archive all notifications" | V (archived)          |

## 5. Wrike Activity for mobile

**Fetched (primary, both current — updated 2026‑06):** [Activity in Wrike for iOS (28554637095703)](https://help.wrike.com/hc/en-us/articles/28554637095703-Activity-in-Wrike-for-iOS) · [Activity in Wrike for Android](https://help.wrike.com/hc/en-us/articles/1500005121541-Activity-in-Wrike-for-Android) · plus [Streams in Wrike](https://help.wrike.com/hc/en-us/articles/209604489-Streams-in-Wrike) for the parent surface. Both Activity pages genuinely describe the screen (they even carry a "TL;DR" and section headings "Open Activity" / "Use Activity").

Confirmed: Activity is a **mobile-only feed, a variant of the Stream tab**; entered from the daily push notification or **More > Activity**; content shown = date/status changes _including the previous status_, new comments (even ones that don't @mention you), approval updates, attachment changes, other task updates; **"Once you open Activity, all updates are marked as read"**; you can **reply to new messages in your tasks**; a daily digest push notification is sent by default and toggled at **Settings > Activity summary**; **"If a task becomes irrelevant for you, swipe left to remove it from Activity."** The Streams article adds that item-level Activity Streams append new updates at the **bottom**, collapse long runs behind **"Show more updates"**, and that clicking an item title opens that item.

| Axis                  | Finding                                                                                                                                                                        | Conf        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Item anatomy          | Event type (status change with previous status / comment / approval / attachment), actor and date implied by "who made each change and when" (stated for the dashboard widget) | V (partial) |
| Actor representation  | Actor named in the update; avatar/style not described                                                                                                                          | V (partial) |
| Information density   | ? (a "digest" feed; row length not documented)                                                                                                                                 | ?           |
| Action count per row  | ? (only "reply" is named per row)                                                                                                                                              | ?           |
| Open/detail behaviour | Selecting an update opens the related task (push); Streams article: click the item title in the stream to open it                                                              | V           |
| Reply from list       | Yes — "Reply to new messages in your tasks" from the digest                                                                                                                    | V           |
| Snooze / dismiss      | No snooze; dismissal = **swipe left to remove** an irrelevant task's updates from Activity                                                                                     | V           |
| Ranking / ordering    | ? (digest of "all your latest updates"; no ordering rule documented)                                                                                                           | ?           |
| Read/unread state     | Acknowledged-on-open: opening Activity marks **all** updates read. No per-row unread concept documented                                                                        | V           |
| Mobile gesture        | Swipe left = remove from Activity (the documented gesture; destructive)                                                                                                        | V           |
| End-of-feed           | ?                                                                                                                                                                              | ?           |

## 6. Universal Inbox

**Fetched (primary, official docs, both 200 and both describing the screen):** [doc.universal-inbox.com/quick_start/inbox_screen](https://doc.universal-inbox.com/quick_start/inbox_screen) · [doc.universal-inbox.com/misc/keyboard_shortcuts](https://doc.universal-inbox.com/misc/keyboard_shortcuts) · plus [how/actions](https://doc.universal-inbox.com/how/actions/) (index only). Images referenced by the page (`inbox-screen.png`, `delete-button.png`, `snooze-button.png`, `unsubscribe-button.png`, `create-task-modal.png`) could not be downloaded or inspected.

Confirmed: two panes — a **notifications list on the left** and a **preview pane on the right that "displays comprehensive details about the selected notification, allowing you to view content without leaving Universal Inbox"**. Each list entry contains, in the documented order: **Source** (GitHub, Linear, Gmail, Slack…), **Type**, **Title** (with contextual details), **Indicators** (author names, notification reasons, PR review status), **Timestamp** (last updated). A badge on the source icon shows which task manager holds a linked task (tooltip "Linked task"). Actions: **Delete** ("remove the notification until its next update"), **Unsubscribe** ("permanently silence this notification and all its future updates"), **Snooze** ("temporarily hide the notification to handle it at a later time"); task actions Convert to Task / Convert to Task with defaults / Link to Existing Task (modal forms with title, project, due date, priority); calendar invite accept/decline inline. Keyboard: ↑/↓ move selection, `d` delete, `u` unsubscribe, `s` snooze, `p`/`t` create task, `l` link, **`Enter` = open notification in the source tool**, `e` = expand/collapse the notification details/thread, `j`/`k`/`Space` scroll the detail thread, `c` = complete task, `y`/`m`/`n` calendar responses, `?` shortcut overlay.

| Axis                  | Finding                                                                                                                                                         | Conf                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Item anatomy          | Source → Type → Title (+context) → Indicators (author, reason, review status) → Timestamp; linked-task badge on the source icon                                 | V                       |
| Actor representation  | Author name lives in the "Indicators" field, not as a leading avatar in the documented order                                                                    | V                       |
| Information density   | Not stated numerically; the list is a narrow left pane with a detail pane beside it, and rows carry 5 fields                                                    | V (partial)             |
| Action count per row  | 3 notification actions named (Delete / Snooze / Unsubscribe) + 3 task actions, reachable by key; whether all are permanently painted on each row is not stated  | V (partial)             |
| Open/detail behaviour | **Overlay/side pane**: right-hand preview pane shows details without leaving the app; plus inline expand/collapse of the thread (`e`)                           | V                       |
| Reply from list       | No — `Enter` opens the notification **in the source tool** to respond; no reply affordance is documented in the inbox itself                                    | V                       |
| Snooze / dismiss      | Explicit **Snooze** ("temporarily hide… for later") and **Delete** ("until its next update") and **Unsubscribe** (permanent silence), each with a dedicated key | V                       |
| Ranking / ordering    | ?                                                                                                                                                               | ?                       |
| Read/unread state     | ? (no unread/acknowledged concept appears in either page)                                                                                                       | ?                       |
| Mobile gesture        | Not applicable/not documented — the documented interaction model is keyboard + pointer, no swipe or long-press                                                  | V (as "not documented") |
| End-of-feed           | ?                                                                                                                                                               | ?                       |

---

## Combined comparison

`V` verified (primary) · `S` secondary · `?` not verified. Cell text is condensed.

| Axis                        | X mobile timeline                                                              | Ambra                                                  | Linear Pulse                                                            | Asana Inbox                                                                        | Wrike Activity (mobile)                                    | Universal Inbox                                                   |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Item anatomy                | ?                                                                              | task text + inline @mention + #tags, order unknown `S` | full project/initiative update text, fields undocumented `V`            | actor + update + new-comment bubble + unread dot `V`                               | event type w/ previous status, actor, date `V`             | Source → Type → Title → Indicators → Timestamp `V`                |
| Actor representation        | ?                                                                              | @mention inside task text `S`                          | ?                                                                       | named in notification; avatar undocumented `V`                                     | named in update; avatar undocumented `V`                   | name inside "Indicators" field `V`                                |
| Info density                | ?                                                                              | ?                                                      | low — full updates, not rows `V`                                        | expand/condense view + thread compression `V`                                      | ?                                                          | 5 fields per row in a narrow left pane `V`                        |
| Permanently visible actions | ?                                                                              | ?                                                      | 2 on mobile: comment, emoji react `V`                                   | 3 on hover: follow-up task, mark unread, archive `V`                               | 1 named: reply `V`                                         | 3 named (delete/snooze/unsubscribe) + 3 task actions via keys `V` |
| Open / detail               | pushes to post detail page `V`                                                 | inline edit of the description `S`                     | reads in place; Inbox opens a dedicated view `V`                        | persistent **right-hand pane** `V`                                                 | pushes to the related task `V`                             | **right-hand preview pane** + inline expand `V`                   |
| Reply without leaving list  | ?                                                                              | ?                                                      | yes — comment on any update `V`                                         | yes — reply + stickers from inbox `V`                                              | yes — reply to new messages `V`                            | no — `Enter` opens the source tool `V`                            |
| Snooze / dismiss            | no snooze; bookmark = save; "Happening now" card is hideable `V`               | ?                                                      | Pulse: none documented (Inbox has snooze+delete) `V`                    | **archive only**, no snooze; Archive all at end of list `V`                        | none; **swipe left removes** the task's updates `V`        | **snooze** + delete + unsubscribe, one key each `V`               |
| Ranking / ordering          | For you vs Following, both explained; replies explicitly non-chronological `V` | chronological, newest first `S`                        | For me / Popular / Recent, each explained `V`                           | Newest First or **Relevance**, user-selectable `V`                                 | ?                                                          | ?                                                                 |
| Read/unread                 | ?                                                                              | ?                                                      | sidebar badge ("only when badged"); per-item semantics undocumented `V` | full model: blue dot, orange sidebar dot, Unread-only filter, mark read/unread `V` | opening Activity marks **all** read (no per-row state) `V` | ?                                                                 |
| Mobile gesture              | customizable swipe for like/reply `S`                                          | drag-and-drop priority `S`                             | ?                                                                       | swipe left → More sheet (3 actions), non-destructive set `V`                       | swipe left = remove (destructive) `V`                      | none documented (keyboard-first) `V`                              |
| End-of-feed                 | ?                                                                              | ?                                                      | ?                                                                       | no "caught up"; end-of-list is an **Archive all** button `V`                       | ?                                                          | ?                                                                 |

### Patterns worth copying (all from rows above)

1. **Ack-on-open is cheaper than per-row unread** — Wrike marks everything read on open; Asana runs the full per-row unread model. Both are legitimate; Wrike's costs nothing to build.
2. **Two products (Asana, Universal Inbox) chose a persistent side pane** over inline expansion, explicitly so the list stays visible ("always open", "without leaving Universal Inbox"). Wrike and X push instead.
3. **Only Universal Inbox has a real snooze.** Asana's equivalent is archive; Wrike's is swipe-to-remove. A "later" action is genuinely differentiating.
4. **Nobody documents an explicit "you're all caught up" terminal state.** Asana comes closest by making the end of the list an action ("Archive all notifications").

## Unverified list — what still needs a logged-in look

- **X:** row anatomy and its order; which actions sit permanently under a post (reply/repost/like/views/bookmark/share) and whether any are hidden behind the engagement-button toggle; per-post "not interested / show fewer posts like this" affordance and how it is invoked; whether an unread/seen concept exists for posts; whether tapping opens detail vs expands inline on mobile; the exact swipe gesture set and whether any is destructive; infinite scroll vs end state.
- **Ambra:** everything except chronology and inline editing — row anatomy, avatars, action count, unread/badge state, whether replies/comments exist in the timeline, gestures, and any end-of-feed state. Also whether the product is still live (last App Store release is 1.0.0, July 2022).
- **Linear Pulse:** row field order and actor presentation; which actions are permanently visible on a Pulse card (desktop vs mobile); whether a Pulse item can be dismissed/snoozed/read; swipe actions on mobile; ordering controls the user can change; end-of-feed behaviour; and whether Pulse items (not Inbox notifications) carry an unread badge.
- **Asana Inbox:** whether the 2023–2024 archived model still matches today's UI (help.asana.com is unreachable without JS/login); current Android gesture set and whether swipe is configurable; whether relevance ordering is explained anywhere in-product; what a row looks like in the condensed vs expanded view; the exact end-of-list treatment now.
- **Wrike Activity:** row anatomy and its order; how many actions are visible on a row besides reply; whether swipe-left has a confirmation/undo (it is the only documented destructive gesture in this set); ordering rule of the digest; end-of-feed behaviour; whether a per-row unread state exists anywhere.
- **Universal Inbox:** ordering rule; any unread/acknowledged concept; whether the three actions are painted on every row or only on the selected row; whether replies are possible in-app at all; and (since the docs are keyboard-centric) whether a mobile build with swipe actions exists.
- **All six:** the actual visual density (rows visible per screen), and the real row anatomy — none of which could be confirmed because every official screenshot was unopenable in this sandbox.
