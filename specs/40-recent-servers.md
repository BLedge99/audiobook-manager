# Spec 40 — Recent servers

## Purpose

The app already lets a listener point at more than one server (the local dev
stack at home, the production deploy, any future secondary — the same pattern
that forced per-server offline shelves in spec 30). Switching today means
remembering the address and typing it into Settings by hand. This feature
keeps a short **recent servers** list in Settings so switching back to a
server used before is one tap.

## Context

- The configured server lives in `localStorage` under `serverUrl`
  (`lib/api.ts`). It is **device-local connection configuration**: it never
  leaves the device except as the target of requests, and it is not personal
  data, so no new lawful-basis or retention documentation is required beyond
  this spec. The list is the same class of data and stays on the device.
- `normaliseServerUrl` already repairs the realistic typos (missing scheme,
  trailing slash). The list stores normalised URLs so two spellings of the
  same server collapse into one entry.
- A server's local identity is its normalised URL (`<serverId>#<bookId>` keys,
  spec 30), so the list keys match the offline shelves exactly.
- Settings ("Save and test") and the first-run `ServerSetup` ("Connect") are
  the two places an address is confirmed working. Both already probe
  `/api/health` before declaring success.

## Behaviour

### The list

- Stored in `localStorage` under `recentServers` as a JSON array of
  normalised URLs, most recently confirmed first.
- Holds at most **5** entries. Confirming a sixth drops the oldest.
- Confirming an address already in the list moves it to the front; it never
  appears twice.
- Entries are recorded only after the health check **succeeds** — in Settings
  ("Save and test") and in first-run setup ("Connect"). A typed-but-unreachable
  address is never recorded, so the list never offers a tap that cannot work.
- On opening Settings, if the currently configured server is not in the list
  it is added (the current server is the most relevant past server). The seed
  is idempotent and adds nothing when the list already holds it.
- Unreadable or malformed storage (private mode, hand-edited JSON, entries
  that fail `normaliseServerUrl`) yields an empty list rather than an error;
  entries that do not normalise are dropped, duplicates collapse.

### The Settings panel

- The server panel shows the list **only when it is non-empty**, under the
  address field and its help line, inside the same panel.
- Each entry is a row: a button with the full address, and a quiet per-row
  "forget" control with an explicit `Forget <address>` accessible label.
- The entry matching the configured server is marked **Current** and stays in
  the list.
- Tapping an entry fills the field with that address and runs the **same**
  save-and-test flow as the form's button — same probe, same offline-mode
  exit, same `onSaved` refresh — so there is one code path, not two.
- Forgetting an entry removes it from the list only. It does not change the
  configured server, and it does not touch anything stored for that server
  (downloads, replica rows, covers). Removing a server from the list is a
  convenience about the menu, not a data action.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where is the list stored? | Device `localStorage`, key `recentServers` — same class of data as the existing `serverUrl` key; device-local, never synced, no server involvement. |
| 2 | What gets recorded? | Only an address whose health check succeeded, confirmed through the same code path in Settings and first-run setup. |
| 3 | How is the list shaped? | JSON array of normalised URLs, MRU first, max 5, de-duplicated by normalised equality. |
| 4 | What does tapping an entry do? | Fills the field and runs the existing save-and-test flow. No parallel switch path, so offline-mode exit and post-switch refresh behave identically. |
| 5 | Can the current server be forgotten? | It is marked Current and can be tapped to re-test, but "forget" is offered per-row like any other; forgetting it changes nothing about the configured server. |

## Acceptance criteria

- [ ] After a successful "Save and test" (or first-run "Connect") in one
      session, the same address appears in Settings' recent-servers list
      without being retyped.
- [ ] Tapping a listed address switches the app to it: the health check runs
      against that address, and on success the app behaves exactly as after
      "Save and test" (explicit offline mode ends, library refreshes).
- [ ] Forgetting an entry removes it from the list and changes nothing else;
      the configured server and its local data are untouched.
- [ ] The list is capped at 5, most-recent-first, with no duplicates, and
      survives an app restart (stored, not in-memory).
- [ ] Malformed stored data does not break the Settings panel; it renders
      with no list shown.
- [ ] First-run setup records the address it just connected to.

## Non-goals

- No server-side or cross-device storage of the list; each device keeps its
  own.
- No per-server nicknames or icons — the address is the label.
- No deletion of per-server offline data when an entry is forgotten.
- No ordering by frequency; recency only.

## Related

- [`specs/26-android-app.md`](26-android-app.md) (server URL in-app),
  [`specs/29-offline-resilience.md`](29-offline-resilience.md) (explicit
  offline exit on a working save),
  [`specs/30-offline-library-per-server.md`](30-offline-library-per-server.md)
  (server identity by normalised URL).
