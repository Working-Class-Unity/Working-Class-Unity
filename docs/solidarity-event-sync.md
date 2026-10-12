# Solidarity event sync

Use these processes for event metadata only. People, RSVP, attendance, consent, and membership data stay outside the website database.
Solidarity remains the authoring system; the WCU website reads SQLite. This is a WCU
connector to an undocumented dashboard interface, not the paid or officially supported Solidarity API.
Two modes share the same collector, planner, and transactional importer:

- the **reviewed on-demand sync** below, for structural or high-attention changes; and
- the **unattended auto sync**, a one-shot scheduled container command that applies validated
  changes automatically and emails a summary.

The server stores no Solidarity passwords or two-factor codes. Unattended mode reads a private
cookie jar (mode 0600) inside the application volume that the organizer workstation refreshes with
the cookie command in that section. An expired session fails the run and sends an alert instead of
guessing.

## One-time setup

- Use the repository's Node 24 and pinned pnpm toolchain, plus an installed Agent Browser CLI with JSON output.
- Sign into `https://dashboard.solidarity.tech` yourself in Agent Browser. The reviewed command reuses that session;
  it never exports cookies, passwords, or two-factor codes. Use `--session NAME` for a named browser session.
  The unattended mode's cookie refresh is a separate explicit command; see [Unattended auto sync](#unattended-auto-sync).
- Deploy the version containing `.output/server/solidarity-event-operator.mjs` through the normal approved
  release process before production use. Reviewed event updates need no new port, public write endpoint, or cron task. The unattended mode also packages `.output/server/solidarity-event-auto.mjs`. Deploying the events-only release requires the separately approved database cutover first.
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

The website can add a campaign tag to one dated occurrence in `event_session_campaign_tags`.
These local additions belong to the occurrence's stable `event_session_id`; they are separate from
Solidarity's series-wide tags and survive metadata sync. The public calendar and campaign sections
combine both sets for that occurrence only. A local tag does not change other dates in the series
or write back to Solidarity. Use a consistent backup and a transaction when making an approved
local edit, then verify the selected occurrence and its untagged sibling dates.

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
these organizer previews private; public importer logs remain count-only.

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
selected occurrences canceled, retaining their IDs and allowed event metadata.
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

## Unattended auto sync

The packaged `solidarity-event-auto.mjs` operator runs inside the web container as a one-shot
scheduled command. It reads the private cookie jar, collects the complete dashboard inventory, plans
against `/app/data/app.db`, and applies every validated change in one transaction with a pre-change
backup. A session missing from a complete inventory is retired immediately, including sessions whose
whole parent series disappeared (the row becomes canceled; IDs and reviewed metadata are retained).
Completed history remains intact. Failed or incomplete collection, unrecognized markup, or
uncertain pairings abort the run without changes.

Compose sets `EVENT_SYNC_COOKIES_PATH=/app/data/solidarity/cookies.json` for the web container.
Set the three Resend variables below in the runtime environment. On the production host, install
the scheduling wrapper from the selected source revision:

```sh
install -m 0755 ops/run-solidarity-event-sync.sh /usr/local/bin/wcu-event-sync
```

Add this to the host crontab, replacing `<applicationUuid>` with the same Coolify application UUID
used in the private connection file:

```cron
*/30 * * * * /usr/local/bin/wcu-event-sync <applicationUuid> >> /var/log/wcu-event-sync.log 2>&1
```

The wrapper resolves exactly one current `web-<applicationUuid>-...` container on each run, so a
redeployment does not leave cron pointing at an old container ID. It holds an application-specific
host lock that the cookie-refresh command also uses. The host needs Docker and `flock` (util-linux).
Use `/usr/local/bin/wcu-event-sync <applicationUuid> --dry-run` for a live collection and database
preview without applying changes or sending email. This still saves rotated session cookies.
Each run prints one JSON summary line (status, counts, receipt and backup paths); it never prints
cookie values or source captures. Receipts land in `/app/data/sync-runs/` (mode 0600) and backups in
`/app/data/backups/`.

Email alerts use Resend and need `EVENT_SYNC_RESEND_API_KEY`, `EVENT_SYNC_ALERT_FROM`, and
`EVENT_SYNC_ALERT_TO` in the container environment. A run with changes emails the applied change list
and retirements; a failed run emails the failure and next steps, including a dashboard sign-in
failure that means the cookie jar needs refreshing. A no-op run is silent. Without Resend
configuration, alerts are skipped with a warning on stderr.

### Cookie refresh

Run this on the organizer workstation, signed into the dashboard in Agent Browser:

```sh
pnpm events:cookies --session solidarity --connection /private/events/production.json
```

The command extracts only `remember_user_token` and the Rails session cookie, writes
`/app/data/solidarity/cookies.json` (mode 0600) in the running web container through the same
validated SSH flow as the reviewed sync, and prints cookie names only. Cookie replacement is atomic
and waits for the shared host lock, so it cannot overwrite cookies being rotated by a running sync.
`--output <path>` saves the private jar locally instead; a recurring refresh should use `--connection`.
An agent running this command needs local CLI access, a signed-in named Agent Browser session, and
the configured SSH identity. Configure its login and recurrence separately; the helper itself is not
a login automation. Refresh weekly as an initial operating cadence and refresh again on a sign-in
failure email; the provider can revoke sessions before the cookies' browser expiry dates. Every
successful sync reuses rotated cookies immediately and saves them for the next run.
Never commit cookie jars, connection files, receipts, or backups, and keep
them outside Git worktrees (the command refuses those paths).

## Source limitations

The collector uses authenticated GET requests to the event inventory, schedule, settings, and session
edit-form pages. Public Event Pages supply descriptions without credentials. It follows explicit inventory
pagination and checks complete required forms, exact timestamps, canonical tags, and reciprocal pairing.
It does not use the limited `/user-filters/event-sessions` lookup as a complete inventory.

Currently listed parents are represented as locally active; past/upcoming is a date distinction, not proof
of provider archival or attendance. Metadata refreshes preserve existing local completed/canceled states
rather than reopening them.
Missing source records are only candidates within the covered event/date scope. The headless collector
marks full discovery explicitly; filtered or unmarked captures cannot authorize unattended retirement.
The auto-sync window covers all retained event dates. Deleted parents keep their stored metadata,
while their scheduled sessions are canceled. The reviewed workflow keeps its selected-parent scope.
Unsupported state/pairing changes need organizer review.
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
pnpm test tests/solidarity-dashboard.test.ts tests/solidarity-headless-collect.test.ts tests/solidarity-event-sync.test.ts tests/solidarity-auto-sync.test.ts tests/solidarity-event-import.test.ts
```

Two small HTML checks cover acquisition and failed reads. One real migrated SQLite integration covers
stable IDs, rescheduling, hybrid grouping, explicit retirement, retained completion status, target binding,
and no-op behavior. Extend these only for a new meaningful contract; do not add tests for constants, wrapper
formatting, or a reversible display expression. A local packaged-CLI rehearsal can use `--database-url
file:/absolute/disposable.db` instead of `--connection`. Never run mutating smoke tests on production.

The events-only import contract is documented in [Events and Solidarity](events-and-solidarity.md).
People/RSVP/attendance report imports are no longer part of this application.
