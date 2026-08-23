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

First normalize one People JSON export and one or more aligned event-metadata/RSVP report pairs:

```sh
pnpm db:normalize:solidarity-events -- \
  --people /private/path/people.json \
  --event /private/path/general-meeting.json \
  --rsvps /private/path/general-meeting-rsvps.csv \
  --event /private/path/steering-meeting.json \
  --rsvps /private/path/steering-meeting-rsvps.csv \
  --bundle /private/path/solidarity-events.json \
  --manifest /private/path/solidarity-events-manifest.json
```

Each event metadata file is an operator-reviewed, schema-versioned allowlist:

```json
{
  "schemaVersion": 1,
  "event": {
    "id": "solidarity-event-id",
    "primaryEventId": null,
    "title": "Event title",
    "description": null,
    "status": "active",
    "timezone": "America/Los_Angeles",
    "eventPageUrl": "https://events.solidarity.tech/example",
    "eventTags": ["audience-public", "category-social"],
    "campaignTags": []
  },
  "sessions": [
    {
      "id": "solidarity-session-id",
      "eventId": "solidarity-event-id",
      "primarySessionId": null,
      "pairedSessionId": null,
      "title": "Dated occurrence",
      "status": "scheduled",
      "eventType": "in_person",
      "startsAt": "2026-09-01T02:00:00.000Z",
      "endsAt": "2026-09-01T03:00:00.000Z",
      "timezone": "America/Los_Angeles",
      "locationName": "Example Hall",
      "locationAddress": "100 Example Street",
      "virtualUrl": null,
      "rsvpUrl": "https://events.solidarity.tech/example"
    }
  ],
  "attendance": []
}
```

Do not infer event type, pairing, tags, visibility, category, location, or attendance from a title or free-form dashboard text. Put those facts explicitly in the reviewed metadata. Attendance records use the normalized importer fields and canonical UTC timestamps shown in the import contract; use an empty array when no attendance was recorded.

The converter reads only People ID, name, primary email, and primary phone from the People report and ignores every other field. From RSVP CSV it reads only RSVP ID, User ID, Session ID, status, and created/updated timestamps. It accepts standard quoted CSV fields, requires the current named headers, and fails closed on malformed records, unsupported values, unknown references, or duplicate normalized activity. A blank RSVP status is omitted and counted as `rsvp_status_missing`, matching the currently observed Solidarity report behavior. The event and RSVP options may be repeated for any number of events, but each event must have exactly one matching RSVP report in the same option order.

The converter has no network or database access. It refuses existing outputs, limits total inputs and the normalized bundle to 25 MiB, writes both new files with mode `0600`, and prints only aggregate counts, issue-code counts, and the bundle hash. Its manifest contains source hashes and counts but no paths, filenames, external IDs, titles, names, or contact data. Keep the source reports, metadata, normalized bundle, and database backups outside Git and shared logs. Review the issue counts and retain the exact manifest and bundle hash used for staging and production.

Run a dry run first:

```sh
pnpm db:import:solidarity-events -- --input=/private/path/solidarity-events.json
```

After reviewing the count-only receipt and issue-code counts, apply the same file:

```sh
pnpm db:import:solidarity-events -- --input=/private/path/solidarity-events.json --apply
```

The input is the normalized converter output, not an untouched dashboard export. It is limited to 25 MiB and has five arrays: `events`, `sessions`, `people`, `rsvps`, and `attendance`. IDs may be numbers or strings. Dates must be canonical UTC timestamps. Events carry Event Tags and Campaign Tags; sessions carry the parent event ID, `in_person` or `virtual` type, optional primary/paired IDs, location, and RSVP URL. A paired/hybrid local session may have only one RSVP and one attendance record per person in a normalized bundle. The importer rejects conflicting mirror records instead of choosing one by input order. It is transactional and idempotent, never matches a person by name, considers only verified local email/phone contacts for automatic matching, quarantines ambiguous matches, and does not infer deletion from a record missing from one report bundle.

The command logs only aggregate counts, the local batch ID, and issue-code counts. Do not put raw exports in Git, fixtures, command output, or public logs.

## Current synchronization boundary

The paid Solidarity API is not used. Dashboard People and RSVP exports plus operator-reviewed event metadata are the supported import boundary. Solidarity's official calendar subscription is promising for automatic event updates, but it includes only future events marked for web calendars and does not document a complete event/session/tag payload. Do not schedule it as the authoritative importer until WCU generates one feed, inspects its stable identifiers and fields, and proves the tag-filter behavior on representative public, member, recurring, and hybrid events.

Native WCU RSVP forms are a later change. They must store a local receipt and reliably create the corresponding Solidarity action so Solidarity confirmations and engagement ladders remain deterministic. Until that contract is available, RSVP links go to Solidarity.
