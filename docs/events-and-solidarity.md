# Events and Solidarity

Solidarity authors WCU events and hosts RSVP forms. The website reads event metadata from SQLite
and sends RSVP visitors to the applicable Solidarity event page. It does not import People, RSVPs,
attendance, contact data, or membership records.

The organizer property and form registry is in [Solidarity taxonomy](solidarity-taxonomy.md).

## Classification

Every event needs one audience tag and one category tag:

| Purpose                                                                  | Event tag           |
| ------------------------------------------------------------------------ | ------------------- |
| Eligible for public website listings                                     | `audience-public`   |
| Retained as restricted metadata; excluded from all public website output | `audience-members`  |
| Meeting                                                                  | `category-meeting`  |
| Collective action, canvass, tabling, rally, or similar mobilization      | `category-action`   |
| Political education, training, forum, or workshop                        | `category-learning` |
| Coffee, game night, meal, or other social gathering                      | `category-social`   |

Meetings also require one subtype: `meeting-general` or `meeting-steering`. These classify events;
they do not create local governance or attendance records.

Campaign Tags currently recorded in the registry are `focus-tenant-union`, `sidequest-2025-06-kyr`,
and `sidequest-2026-03-deflock-stockton`. Approved future tags follow `focus-*` or `sidequest-*`.
They remain event classification; a separate campaign/Side-Quest database is future work.

The public calendar uses these display labels for the existing campaign tags:

- `SQ - United Front`: `sidequest-2025-06-kyr` (the existing Know Your Rights / United Front work).
- `SQ - Deflock Stockton`: `sidequest-2026-03-deflock-stockton`.
- `CA - Tenant Union`: `focus-tenant-union`, shown as a disabled future option until the campaign is ready.

Type and campaign filters combine and apply to both agenda and month views. Unlabelled events
remain visible under All campaigns. The public read exposes only these known campaign tags.
The display mapping does not change Solidarity records or taxonomy. Events without an approved
campaign tag appear only under All campaigns. Desktop shows type buttons and a campaign select;
narrow layouts use two native selects. Clear filters preserves a selected date; All upcoming events
resets the date, type, and campaign together.

Before publishing or updating:

1. Set the title, description, timezone, sessions, format, location, and Event Page in Solidarity.
2. Add one audience and category tag; add a meeting subtype when applicable.
3. Add an approved Campaign Tag when applicable.
4. Set the hosted RSVP destination and any confirmations inside Solidarity.
5. Create a separate event if an occurrence needs a different audience or category.

Missing or conflicting classification hides the event and produces an import issue. Unregistered
Event Tags or invalid campaign naming are rejected. Never infer classification from a title.
The audience tag governs WCU publication, not access to a separately known Solidarity URL.

## Local record

The database retains event series, dated sessions, canonical tags, stable Solidarity event/session
links, and minimal import/sync provenance. A recurring series has several sessions; a hybrid pair
is represented by one local session with both provider links. A session may have its own display title.

Only allowlisted event fields enter SQLite. Arbitrary source snapshots and metadata must not carry
personal records into the database. Private source captures and reviewed previews stay outside Git.

## Updating the calendar

Use the [on-demand browser-assisted sync](solidarity-event-sync.md) for ordinary updates. Collect
metadata from an authenticated organizer browser, review its preview, and apply the exact approved
change. The server stores no Solidarity login credentials and runs no unattended sync.

For an already normalized events-only bundle, use the importer:

```bash
node scripts/run-pnpm.mjs run db:import:solidarity-events -- --input=/private/events/events.json
node scripts/run-pnpm.mjs run db:import:solidarity-events -- --input=/private/events/events.json --apply
```

The first command is a dry run. Apply only the same reviewed input. The importer validates the
bundle before transactionally writing it and reports aggregate counts and issue codes. Use the
current exported event import schema; People/RSVP/attendance report conversion is no longer supported.

Provider IDs preserve identity during rescheduling and hybrid pairing. Missing records do not mean
deletion: explicitly select missing occurrences for retirement through the reviewed sync workflow.
Failed or incomplete collection cannot authorize retirement. Repeated unchanged input should be a no-op.
