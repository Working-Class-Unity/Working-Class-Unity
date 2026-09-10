# On-demand Solidarity event sync

Use this process for event metadata, not People, RSVP, attendance, consent, or membership data.
Solidarity remains the authoring system; the WCU website reads SQLite. This is a WCU browser-assisted
connector to an undocumented dashboard interface, not the paid or officially supported Solidarity API.
It runs on demand. Do not schedule unattended synchronization or store Solidarity credentials on the server.

## One-time setup

- Use the repository's Node 24 and pinned pnpm toolchain, plus an installed Agent Browser CLI with JSON output.
- Sign into `https://dashboard.solidarity.tech` yourself in Agent Browser. The command reuses that session;
  it never exports cookies, passwords, or two-factor codes. Use `--session NAME` for a named browser session.
- Deploy the version containing `.output/server/solidarity-event-operator.mjs` through the normal approved
  release process before production use. No database migration, new port, public write endpoint, or cron task is needed.
- Keep an SSH connection file outside Git. The server must already be in `known_hosts`; SSH uses batch
  authentication and strict host-key verification. Its account needs access to Docker on the intended server.

Example private connection file:

```json
{
  "host": "root@your-server",
  "identity": "/private/path/existing-ssh-key",
  "applicationUuid": "your-coolify-application-uuid"
}
```

An existing SSH alias can replace `host`, and `identity` can be omitted when the alias configures the key.
The command resolves exactly one running `web-<applicationUuid>-...` container each time. It streams JSON
to the packaged operator over SSH stdin; it does not transfer data through scheduled-task command strings.

## Routine update

Edit the event in Solidarity first. Keep the registered audience/category/campaign rules in
[`solidarity-taxonomy.md`](solidarity-taxonomy.md). A session title can differ from its parent series title.

### Collect and preview

```sh
pnpm events:sync preview \
  --from 2026-09-01T07:00:00.000Z --to 2026-10-01T07:00:00.000Z \
  --output /private/events/september-preview.json \
  --connection /private/events/production.json
```

Bounds are inclusive `from`, exclusive `to`, in canonical UTC. This example covers September in Pacific
time. The capture timezone defaults to `America/Los_Angeles`; use `--timezone` when a different reviewed
timezone is required. Do not mix events with different timezones in one capture.

Omit `--event` to discover the dashboard inventory, or repeat `--event ID` to review particular series.
The collector reads full session inventories for those parents. The planner updates only occurrences
whose current source date **or existing local date** falls inside the requested window, keeping paired
halves together. Thus moving a September session into October does not falsely retire it.

The output is a short list of series/session changes, issue codes, and retirement candidates. Review
series-level changes carefully: descriptions, classification, and audience apply to the whole series.
The collector copies descriptions as plain text, including lists and line breaks; it does not rewrite them.

The command writes `september-preview.json` and `september-preview.json.capture.json` with mode `0600`,
refuses existing outputs, and refuses output inside a Git worktree. The private preview retains the exact
capture, proposed state, database baseline, and approval digest. Console previews show event metadata,
not descriptions, locations, signed meeting URLs, raw HTML, authentication, or personal records. Keep
these organizer previews private; the report/activity importer's public logging remains count-only.

If server preview fails after collection, reuse the saved capture instead of collecting again:

```sh
pnpm events:sync preview --capture /private/events/september-preview.json.capture.json \
  --output /private/events/september-reviewed.json --connection /private/events/production.json
```

### Approve and apply

```sh
pnpm events:sync apply --preview /private/events/september-preview.json \
  --approve EXACT_DIGEST_FROM_PREVIEW --connection /private/events/production.json
```

To retire an explicitly reviewed missing occurrence, append `--retire LOCAL_SESSION_ID` from the preview.
Repeat that option for multiple candidates. No retirement option means no retirement. The importer marks
selected occurrences canceled, retaining their IDs, source metadata, RSVP, and attendance history.
It does not hard-delete records or guess replacements by title.

Apply verifies the target and reviewed digest, checks for a stale database baseline, takes one consistent
SQLite backup under the database's `backups/` directory when there are changes, and performs the import
and affected-record readback in one transaction. A concurrent metadata change causes a refusal and a new
preview, not an overwrite. A true no-op creates no backup or import batch. A private receipt is written
next to the preview; inspect its result and the affected website listings.

There is no automatic retry. If SSH disconnects during apply, the result may be unknown: reconnect and
make a fresh preview before deciding what remains. Do not repeatedly apply an old preview. Keep the
backup and receipt private; restoring a whole database is a separate recovery operation, not an automatic
undo that is safe alongside other writers.

## Source limitations

The collector uses authenticated GET requests to the event inventory, schedule, settings, and session
edit-form pages. Public Event Pages supply descriptions without credentials. It follows explicit inventory
pagination and checks complete required forms, exact timestamps, canonical tags, and reciprocal pairing.
It does not use the limited `/user-filters/event-sessions` lookup as a complete inventory.

Currently listed parents are represented as locally active; past/upcoming is a date distinction, not proof
of provider archival or attendance. Metadata refreshes preserve existing local completed/canceled states
rather than reopening them or removing attendance credit.
Missing source records are only candidates within the covered event/date scope. Parents absent from the
covered inventory are not automatically archived. Unsupported state/pairing changes need organizer review.
Existing hybrid groups cannot be silently downgraded by incomplete input.

An expired login, failed request, missing required markup, or inconsistent pairing aborts collection.
A confirmed empty description or a legacy event with no Event Page is represented as null, not fabricated.
If the dashboard changes, stop and update the collector using the actual source markup; do not improvise
classification or run an alternative undocumented endpoint until something appears to work.

## Verification proportional to change

Routine data edits use the built-in validation, one backup when needed, transactional readback, and the
receipt. They do not require a test suite, disposable-copy rehearsal, or a second full database scan.

When changing collector or reconciliation code, run the focused suites:

```sh
pnpm test tests/solidarity-dashboard.test.ts tests/solidarity-event-sync.test.ts tests/solidarity-event-import.test.ts
```

Two small HTML checks cover acquisition and failed reads. One real migrated SQLite integration covers
stable IDs, rescheduling, hybrid grouping, explicit retirement, retained completion/activity, target binding,
and no-op behavior. Extend these only for a new meaningful contract; do not add tests for constants, wrapper
formatting, or a reversible display expression. A local packaged-CLI rehearsal can use `--database-url
file:/absolute/disposable.db` instead of `--connection`. Never run mutating smoke tests on production.

Report-based People/RSVP/attendance imports remain separate under [`events-and-solidarity.md`](events-and-solidarity.md).
