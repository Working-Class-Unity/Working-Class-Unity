import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import * as schema from '../server/db/schema/index'
import { importSolidarityEventDataset } from '../server/services/events/solidarity-import'
import {
  solidarityAudienceTags,
  solidarityCategoryTags,
  solidarityMeetingTags
} from '../server/services/events/solidarity-taxonomy'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const observedAt = new Date('2026-08-23T20:00:00.000Z')

describe('Solidarity event import', () => {
  it('defines the exact website-interpreted Event Tags', () => {
    expect([...solidarityAudienceTags, ...solidarityCategoryTags, ...solidarityMeetingTags]).toEqual([
      'audience-members',
      'audience-public',
      'category-action',
      'category-learning',
      'category-meeting',
      'category-social',
      'meeting-general',
      'meeting-steering'
    ])
  })

  it('projects tagged events, paired hybrid sessions, people, RSVPs, and attendance idempotently', () => {
    withMigratedDatabase((sqlite, connection) => {
      const dataset = {
        events: [
          {
            id: 'event-general',
            title: 'WCU General Meeting',
            description: 'Monthly membership meeting',
            status: 'active',
            timezone: 'America/Los_Angeles',
            eventPageUrl: 'https://events.example.test/general',
            eventTags: ['audience-public', 'category-meeting', 'meeting-general'],
            campaignTags: ['focus-tenant-union']
          },
          {
            id: 'event-steering',
            title: 'WCU Steering Committee Meeting',
            status: 'active',
            timezone: 'America/Los_Angeles',
            eventPageUrl: 'https://events.example.test/steering',
            eventTags: ['audience-members', 'category-meeting', 'meeting-steering'],
            campaignTags: []
          }
        ],
        sessions: [
          {
            id: 'session-general-in-person',
            pairedSessionId: 'session-general-virtual',
            eventId: 'event-general',
            title: 'September general meeting',
            status: 'completed',
            eventType: 'in_person',
            startsAt: '2026-09-18T02:00:00.000Z',
            endsAt: '2026-09-18T03:30:00.000Z',
            timezone: 'America/Los_Angeles',
            locationName: 'OF Hall',
            locationAddress: '2522 Grand Canal Blvd, Stockton, CA',
            rsvpUrl: 'https://events.example.test/general?session=hybrid'
          },
          {
            id: 'session-general-virtual',
            pairedSessionId: 'session-general-in-person',
            eventId: 'event-general',
            title: 'September general meeting',
            status: 'completed',
            eventType: 'virtual',
            startsAt: '2026-09-18T02:00:00.000Z',
            endsAt: '2026-09-18T03:30:00.000Z',
            timezone: 'America/Los_Angeles',
            virtualUrl: 'https://meet.example.test/general',
            rsvpUrl: 'https://events.example.test/general?session=hybrid'
          },
          {
            id: 'session-steering',
            eventId: 'event-steering',
            status: 'scheduled',
            eventType: 'virtual',
            startsAt: '2026-09-08T02:00:00.000Z',
            timezone: 'America/Los_Angeles',
            virtualUrl: 'https://meet.example.test/steering',
            rsvpUrl: 'https://events.example.test/steering'
          }
        ],
        people: [
          {
            id: 'person-member',
            firstName: 'Test',
            lastName: 'Member',
            email: 'member@example.test',
            phone: '+12095550100'
          }
        ],
        rsvps: [
          {
            id: 'rsvp-general',
            userId: 'person-member',
            sessionId: 'session-general-in-person',
            status: 'yes',
            respondedAt: '2026-08-20T20:00:00.000Z'
          }
        ],
        attendance: [
          {
            id: 'attendance-general',
            userId: 'person-member',
            sessionId: 'session-general-virtual',
            status: 'attended',
            recordedAt: '2026-09-18T03:35:00.000Z',
            checkedInAt: '2026-09-18T02:05:00.000Z',
            checkedOutAt: '2026-09-18T03:25:00.000Z'
          }
        ]
      } as const

      expect(() =>
        importSolidarityEventDataset(
          connection,
          {
            ...dataset,
            rsvps: [
              ...dataset.rsvps,
              {
                id: 'rsvp-general-mirror',
                userId: 'person-member',
                sessionId: 'session-general-virtual',
                status: 'yes',
                respondedAt: '2026-08-20T20:00:00.000Z'
              }
            ]
          },
          { apply: false, observedAt }
        )
      ).toThrow(/duplicate normalized RSVP person\/session/)

      const dryRun = importSolidarityEventDataset(connection, dataset, { apply: false, observedAt })
      expect(dryRun.mode).toBe('dry-run')
      expect(dryRun.events).toEqual({ hidden: 0, imported: 2 })
      expect(dryRun.sessions).toEqual({ imported: 2, providerLinks: 3 })
      expect(count(sqlite, 'events')).toBe(0)

      const first = importSolidarityEventDataset(connection, dataset, { apply: true, observedAt })
      const second = importSolidarityEventDataset(connection, dataset, {
        apply: true,
        observedAt: new Date('2026-08-24T20:00:00.000Z')
      })

      expect(first.issues).toEqual([])
      expect(second.snapshots.unchanged).toBeGreaterThan(0)
      expect(count(sqlite, 'events')).toBe(2)
      expect(count(sqlite, 'event_sessions')).toBe(2)
      expect(count(sqlite, 'event_provider_links')).toBe(2)
      expect(count(sqlite, 'event_session_provider_links')).toBe(3)
      expect(count(sqlite, 'people')).toBe(1)
      expect(count(sqlite, 'provider_identities')).toBe(1)
      expect(count(sqlite, 'rsvps')).toBe(1)
      expect(count(sqlite, 'attendance')).toBe(1)
      expect(count(sqlite, 'attendance_intervals')).toBe(1)
      expect(count(sqlite, 'import_batches')).toBe(2)

      expect(
        sqlite
          .prepare(
            `select e.visibility, e.kind as category, es.delivery_mode as deliveryMode,
                    m.kind as meetingKind, count(espl.id) as providerLinks
             from events e
             join event_sessions es on es.event_id = e.id
             join meetings m on m.event_session_id = es.id
             join event_session_provider_links espl on espl.event_session_id = es.id
             where e.title = 'WCU General Meeting'`
          )
          .get()
      ).toEqual({
        category: 'meeting',
        deliveryMode: 'hybrid',
        meetingKind: 'general',
        providerLinks: 2,
        visibility: 'public'
      })
      expect(
        sqlite
          .prepare(
            `select e.visibility, m.kind as meetingKind
             from events e join event_sessions es on es.event_id = e.id
             join meetings m on m.event_session_id = es.id
             where e.title = 'WCU Steering Committee Meeting'`
          )
          .get()
      ).toEqual({ meetingKind: 'steering', visibility: 'members' })

      const reclassifiedDataset = {
        ...dataset,
        events: dataset.events.map((event) =>
          event.id === 'event-general'
            ? { ...event, eventTags: ['audience-public', 'category-social'] as const }
            : event
        )
      }
      importSolidarityEventDataset(connection, reclassifiedDataset, {
        apply: true,
        observedAt: new Date('2026-08-25T20:00:00.000Z')
      })
      expect(
        sqlite
          .prepare(
            `select e.kind as category, m.kind as meetingKind
             from events e join event_sessions es on es.event_id = e.id
             left join meetings m on m.event_session_id = es.id
             where e.title = 'WCU General Meeting'`
          )
          .get()
      ).toEqual({ category: 'social', meetingKind: null })
    })
  })

  it('accepts governed taxonomy and rejects noncanonical tags without writing', () => {
    withMigratedDatabase((sqlite, connection) => {
      const event = {
        campaignTags: [
          'sidequest-2025-06-kyr',
          'sidequest-2026-03-deflock-stockton',
          'focus-worker-organizing',
          'sidequest-2026-09-mutual-aid',
          'sidequest-mutual-aid'
        ],
        eventTags: ['audience-public', 'category-action'],
        id: 'event-taxonomy',
        status: 'active',
        timezone: 'America/Los_Angeles',
        title: 'Governed campaign action'
      } as const
      const dataset = { attendance: [], events: [event], people: [], rsvps: [], sessions: [] } as const

      expect(importSolidarityEventDataset(connection, dataset, { apply: true, observedAt }).issues).toEqual([])
      expect(
        sqlite
          .prepare(
            `select kind, value from event_tags where event_id =
               (select event_id from event_provider_links where external_id = 'event-taxonomy')
             order by kind, value`
          )
          .all()
      ).toEqual([
        { kind: 'campaign', value: 'focus-worker-organizing' },
        { kind: 'campaign', value: 'sidequest-2025-06-kyr' },
        { kind: 'campaign', value: 'sidequest-2026-03-deflock-stockton' },
        { kind: 'campaign', value: 'sidequest-2026-09-mutual-aid' },
        { kind: 'campaign', value: 'sidequest-mutual-aid' },
        { kind: 'event', value: 'audience-public' },
        { kind: 'event', value: 'category-action' }
      ])

      const persistedCounts = {
        events: count(sqlite, 'events'),
        eventTags: count(sqlite, 'event_tags'),
        importBatches: count(sqlite, 'import_batches'),
        snapshots: count(sqlite, 'external_record_snapshots')
      }

      expect(() =>
        importSolidarityEventDataset(
          connection,
          { ...dataset, events: [{ ...event, eventTags: [...event.eventTags, 'KYR'] }] },
          { apply: true, observedAt }
        )
      ).toThrow('Solidarity event tag is not governed: KYR')
      expect(() =>
        importSolidarityEventDataset(
          connection,
          { ...dataset, events: [{ ...event, campaignTags: ['sq_2026-03_finishflock'] }] },
          { apply: true, observedAt }
        )
      ).toThrow('Solidarity campaign tag does not follow the governed naming convention: sq_2026-03_finishflock')
      expect(() =>
        importSolidarityEventDataset(
          connection,
          { ...dataset, events: [{ ...event, campaignTags: ['campaign-misc'] }] },
          { apply: true, observedAt }
        )
      ).toThrow('Solidarity campaign tag does not follow the governed naming convention: campaign-misc')
      expect({
        events: count(sqlite, 'events'),
        eventTags: count(sqlite, 'event_tags'),
        importBatches: count(sqlite, 'import_batches'),
        snapshots: count(sqlite, 'external_record_snapshots')
      }).toEqual(persistedCounts)
    })
  })

  it('keeps an existing local session identity when Solidarity adds a hybrid counterpart', () => {
    withMigratedDatabase((sqlite, connection) => {
      const event = {
        campaignTags: [],
        eventTags: ['audience-public', 'category-social'],
        id: 'event-pairing',
        status: 'active',
        timezone: 'America/Los_Angeles',
        title: 'Community gathering'
      } as const
      const originalSession = {
        eventId: 'event-pairing',
        eventType: 'virtual',
        id: 'session-z',
        startsAt: '2026-10-01T02:00:00.000Z',
        status: 'scheduled',
        timezone: 'America/Los_Angeles',
        virtualUrl: 'https://meet.example.test/gathering'
      } as const
      importSolidarityEventDataset(
        connection,
        { attendance: [], events: [event], people: [], rsvps: [], sessions: [originalSession] },
        { apply: true, observedAt }
      )
      const originalLocalId = (
        sqlite
          .prepare(
            `select event_session_id as localId from event_session_provider_links
             where external_id = 'session-z'`
          )
          .get() as { localId: string }
      ).localId

      importSolidarityEventDataset(
        connection,
        {
          attendance: [],
          events: [{ ...event, primaryEventId: 'event-primary' }],
          people: [],
          rsvps: [],
          sessions: [{ ...originalSession, primarySessionId: 'session-a' }]
        },
        { apply: true, observedAt: new Date('2026-08-24T20:00:00.000Z') }
      )
      importSolidarityEventDataset(
        connection,
        {
          attendance: [],
          events: [{ ...event, id: 'event-primary' }],
          people: [],
          rsvps: [],
          sessions: [
            {
              eventId: 'event-primary',
              eventType: 'in_person',
              id: 'session-a',
              locationName: 'Union hall',
              startsAt: originalSession.startsAt,
              status: 'scheduled',
              timezone: 'America/Los_Angeles'
            }
          ]
        },
        { apply: true, observedAt: new Date('2026-08-25T20:00:00.000Z') }
      )

      importSolidarityEventDataset(
        connection,
        {
          attendance: [],
          events: [event],
          people: [],
          rsvps: [],
          sessions: [
            { ...originalSession, pairedSessionId: 'session-a' },
            {
              eventId: 'event-pairing',
              eventType: 'in_person',
              id: 'session-a',
              locationName: 'Union hall',
              pairedSessionId: 'session-z',
              startsAt: originalSession.startsAt,
              status: 'scheduled',
              timezone: 'America/Los_Angeles'
            }
          ]
        },
        { apply: true, observedAt: new Date('2026-08-26T20:00:00.000Z') }
      )

      expect(count(sqlite, 'event_sessions')).toBe(1)
      expect(count(sqlite, 'events')).toBe(1)
      expect(
        sqlite
          .prepare(
            `select count(distinct event_id) as count from event_provider_links
             where external_id in ('event-pairing', 'event-primary')`
          )
          .get()
      ).toEqual({ count: 1 })
      expect(
        sqlite
          .prepare(
            `select distinct event_session_id as localId from event_session_provider_links
             where external_id in ('session-a', 'session-z')`
          )
          .all()
      ).toEqual([{ localId: originalLocalId }])
    })
  })

  it('fails visibility closed and quarantines ambiguous people without partial activity links', () => {
    withMigratedDatabase((sqlite, connection) => {
      sqlite.prepare("insert into people (id, display_name) values ('person-a', 'A'), ('person-b', 'B')").run()
      sqlite
        .prepare(
          `insert into person_contacts
             (id, person_id, kind, value, normalized_value, is_primary, verified_at)
           values ('contact-a', 'person-a', 'email', 'shared@example.test', 'shared@example.test', 1,
                     '2026-08-01T00:00:00.000Z'),
                  ('contact-b', 'person-b', 'email', 'shared@example.test', 'shared@example.test', 1,
                     '2026-08-01T00:00:00.000Z')`
        )
        .run()

      const report = importSolidarityEventDataset(
        connection,
        {
          events: [
            {
              id: 'event-ambiguous',
              title: 'Unclassified event',
              status: 'active',
              timezone: 'America/Los_Angeles',
              eventTags: ['audience-public', 'audience-members', 'category-social'],
              campaignTags: []
            },
            {
              id: 'event-missing-category',
              title: 'Missing category',
              status: 'active',
              timezone: 'America/Los_Angeles',
              eventTags: ['audience-public'],
              campaignTags: []
            },
            {
              id: 'event-missing-meeting-subtype',
              title: 'Missing meeting subtype',
              status: 'active',
              timezone: 'America/Los_Angeles',
              eventTags: ['audience-public', 'category-meeting'],
              campaignTags: []
            }
          ],
          sessions: [
            {
              id: 'session-ambiguous',
              eventId: 'event-ambiguous',
              status: 'scheduled',
              eventType: 'in_person',
              startsAt: '2026-10-01T02:00:00.000Z',
              timezone: 'America/Los_Angeles'
            },
            {
              id: 'session-missing-category',
              eventId: 'event-missing-category',
              status: 'scheduled',
              eventType: 'in_person',
              startsAt: '2026-10-02T02:00:00.000Z',
              timezone: 'America/Los_Angeles'
            },
            {
              id: 'session-missing-meeting-subtype',
              eventId: 'event-missing-meeting-subtype',
              status: 'scheduled',
              eventType: 'in_person',
              startsAt: '2026-10-03T02:00:00.000Z',
              timezone: 'America/Los_Angeles'
            }
          ],
          people: [{ id: 'user-ambiguous', email: 'SHARED@example.test' }],
          rsvps: [
            {
              id: 'rsvp-ambiguous',
              userId: 'user-ambiguous',
              sessionId: 'session-ambiguous',
              status: 'yes',
              respondedAt: '2026-08-23T19:00:00.000Z'
            }
          ],
          attendance: []
        },
        { apply: true, observedAt }
      )

      expect(report.issues.map(({ code }) => code).sort()).toEqual([
        'ambiguous_person_match',
        'invalid_audience_tags',
        'invalid_category_tags',
        'invalid_meeting_tags',
        'rsvp_person_unresolved'
      ])
      expect(report.events).toEqual({ hidden: 3, imported: 3 })
      expect(sqlite.prepare("select visibility from events where title = 'Unclassified event'").get()).toEqual({
        visibility: 'hidden'
      })
      expect(
        sqlite
          .prepare("select person_id as personId, state from provider_identities where provider = 'solidarity'")
          .get()
      ).toEqual({ personId: null, state: 'unlinked' })
      expect(count(sqlite, 'rsvps')).toBe(0)
    })
  })

  it('rejects an invalid timezone before writing event data', () => {
    withMigratedDatabase((sqlite, connection) => {
      expect(() =>
        importSolidarityEventDataset(
          connection,
          {
            attendance: [],
            events: [
              {
                campaignTags: [],
                eventTags: ['audience-public', 'category-social'],
                id: 'event-invalid-timezone',
                status: 'active',
                timezone: 'Not/A_Timezone',
                title: 'Invalid timezone event'
              }
            ],
            people: [],
            rsvps: [],
            sessions: []
          },
          { apply: true, observedAt }
        )
      ).toThrow(/event timezone is not supported/)
      expect(count(sqlite, 'events')).toBe(0)
    })
  })

  it('keeps the manual operator dry by default and prints only a redacted receipt', () => {
    withMigratedDatabase((sqlite, connection) => {
      const inputPath = join(connection.databasePath, '..', 'solidarity.json')
      writeFileSync(
        inputPath,
        JSON.stringify({
          attendance: [],
          events: [
            {
              campaignTags: [],
              eventTags: ['audience-public', 'category-social'],
              id: 'private-external-event-id',
              status: 'active',
              timezone: 'America/Los_Angeles',
              title: 'Private fixture title'
            }
          ],
          people: [{ email: 'private-person@example.test', id: 'private-person-id' }],
          rsvps: [],
          sessions: [
            {
              eventId: 'private-external-event-id',
              eventType: 'in_person',
              id: 'private-session-id',
              startsAt: '2026-10-01T02:00:00.000Z',
              status: 'scheduled',
              timezone: 'America/Los_Angeles'
            }
          ]
        })
      )

      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/import-solidarity-events.ts',
          '--input',
          inputPath,
          '--database-url',
          connection.databasePath
        ],
        { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }
      )

      expect(result.status, result.stderr).toBe(0)
      const receipt = JSON.parse(result.stdout) as { batchId: string | null; mode: string }
      expect(receipt).toMatchObject({ batchId: null, mode: 'dry-run' })
      expect(result.stdout).not.toContain('private-person@example.test')
      expect(result.stdout).not.toContain('private-external-event-id')
      expect(result.stdout).not.toContain('Private fixture title')
      expect(count(sqlite, 'events')).toBe(0)
    })
  })
})

function withMigratedDatabase(
  run: (
    sqlite: InstanceType<typeof Database>,
    connection: {
      databasePath: string
      db: ReturnType<typeof drizzle<typeof schema>>
      sqlite: InstanceType<typeof Database>
    }
  ) => void
) {
  const root = mkdtempSync(join(tmpdir(), 'wcu-solidarity-import-'))
  const databasePath = join(root, 'import.sqlite')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    run(sqlite, { databasePath, db: drizzle({ client: sqlite, schema }), sqlite })
  } finally {
    sqlite.close()
    rmSync(root, { recursive: true, force: true })
  }
}

function count(sqlite: InstanceType<typeof Database>, table: string): number {
  return (sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
}
