# Events and Solidarity

Solidarity is the event-authoring system for WCU. SQLite is the durable WCU record and the website reads only from SQLite. The website does not create or edit Solidarity events, and its RSVP buttons currently open the applicable Solidarity event page.

## Organizer convention

Every Solidarity event must have exactly one audience tag and one category tag:

| Purpose                                                                        | Allowed event tag   |
| ------------------------------------------------------------------------------ | ------------------- |
| Visible to anyone on the WCU website                                           | `audience-public`   |
| Visible only to a signed-in website account linked to an active WCU membership | `audience-members`  |
| Meeting                                                                        | `category-meeting`  |
| Collective action, canvass, tabling, rally, or similar mobilization            | `category-action`   |
| Political education, training, forum, or workshop                              | `category-learning` |
| Coffee, game night, meal, or other social gathering                            | `category-social`   |

Meetings also require exactly one subtype tag:

- `meeting-general` for WCU General Meetings;
- `meeting-steering` for Steering Committee meetings.

Keep other existing event and campaign tags. They are imported unchanged for provenance and reporting, but they do not determine website visibility or category.

Before publishing or updating an event:

1. Set its title, description, timezone, sessions, format, location, and Event Page in Solidarity.
2. Add one `audience-*` tag.
3. Add one `category-*` tag.
4. For a meeting, add one `meeting-*` tag.
5. Make the Event Page the RSVP destination and enable the desired Solidarity confirmations and automations.
6. If one occurrence needs a different audience or category, create a separate Solidarity event rather than putting conflicting tags on a session.

Missing, duplicated, or conflicting classification tags make the local event `hidden` and create an import issue. The audience tag controls only the WCU website. Solidarity has no true private-event setting, so anyone who already knows a member event's direct Solidarity URL may still open it.

## Local model

- `events` is the stable series or program, such as “WCU General Meeting.”
- `event_sessions` is a dated occurrence. A one-time event has one session; a recurring event has several.
- A Solidarity hybrid pair becomes one local session with two provider links.
- `event_tags` retains both Event Tags and Campaign Tags.
- `event_provider_links` and `event_session_provider_links` retain Solidarity IDs, primary IDs, mirror IDs, and hybrid-pair IDs.
- RSVPs and attendance attach to a person and an existing Solidarity-linked session. Attendance recording cannot create or reclassify events. General- and steering-meeting meaning is stored separately in `meetings`.
- Raw imported records are retained through `import_batches` and `external_record_snapshots`; application and API responses never expose those payloads.

The category names shown to website visitors are Meeting, Action, Learning, and Social. They are intentionally based on useful browsing filters rather than every internal organizing activity recorded in old minutes.

## Import operation

Run a dry run first:

```sh
pnpm db:import:solidarity-events -- --input=/private/path/solidarity-events.json
```

After reviewing the count-only receipt and issue-code counts, apply the same file:

```sh
pnpm db:import:solidarity-events -- --input=/private/path/solidarity-events.json --apply
```

The input is a normalized bundle assembled from one or more Solidarity reports, not an untouched dashboard export. It is limited to 25 MiB and has five arrays: `events`, `sessions`, `people`, `rsvps`, and `attendance`. IDs may be numbers or strings. Dates must be canonical UTC timestamps. Events carry Event Tags and Campaign Tags; sessions carry the parent event ID, `in_person` or `virtual` type, optional primary/paired IDs, location, and RSVP URL. A paired/hybrid local session may have only one RSVP and one attendance record per person in a normalized bundle. The importer rejects conflicting mirror records instead of choosing one by input order. It is transactional and idempotent, never matches a person by name, considers only verified local email/phone contacts for automatic matching, quarantines ambiguous matches, and does not infer deletion from a record missing from one report bundle.

The command logs only aggregate counts, the local batch ID, and issue-code counts. Do not put raw exports in Git, fixtures, command output, or public logs.

## Current synchronization boundary

The paid Solidarity API is not used. Manually assembled and validated report bundles are the supported import boundary in this commit. Solidarity's official calendar subscription is promising for automatic event updates, but it includes only future events marked for web calendars and does not document a complete event/session/tag payload. Do not schedule it as the authoritative importer until WCU generates one feed, inspects its stable identifiers and fields, and proves the tag-filter behavior on representative public, member, recurring, and hybrid events.

Native WCU RSVP forms are a later change. They must store a local receipt and reliably create the corresponding Solidarity action so Solidarity confirmations and engagement ladders remain deterministic. Until that contract is available, RSVP links go to Solidarity.
