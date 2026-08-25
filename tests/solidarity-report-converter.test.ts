import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertSolidarityEventReports } from '../server/services/events/solidarity-report-converter'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const csvHeaders = [
  'RSVP ID',
  'User ID',
  'First Name',
  'Last Name',
  'Email',
  'Phone Number',
  'Session ID',
  'Session Title',
  'Session Start',
  'Session End',
  'Session Location',
  'RSVP Status',
  'Confirmed?',
  'Source',
  'Created At',
  'Updated At'
] as const

describe('Solidarity report converter', () => {
  it('combines five event reports deterministically while quarantining only blank RSVP statuses', () => {
    const inputs = syntheticInputs()
    const first = convertSolidarityEventReports(inputs)
    const second = convertSolidarityEventReports(inputs)

    expect(second).toEqual(first)
    expect(first.bundle.events).toHaveLength(5)
    expect(first.bundle.sessions).toHaveLength(5)
    expect(first.bundle.people).toHaveLength(2)
    expect(first.bundle.rsvps).toEqual([
      {
        id: 'rsvp-1',
        respondedAt: '2026-08-24T01:02:03.000Z',
        sessionId: 'session-1',
        status: 'yes',
        userId: 'person-1'
      },
      {
        id: 'rsvp-2',
        respondedAt: '2026-08-24T02:02:03.000Z',
        sessionId: 'session-2',
        status: 'maybe',
        userId: 'person-2'
      }
    ])
    expect(first.bundle.attendance).toEqual([
      {
        checkedInAt: null,
        checkedOutAt: null,
        id: 'attendance-1',
        recordedAt: '2026-08-25T03:00:00.000Z',
        sessionId: 'session-1',
        status: 'attended',
        userId: 'person-1'
      }
    ])
    expect(first.manifest).toMatchObject({
      bundleCounts: { attendance: 1, events: 5, people: 2, rsvps: 2, sessions: 5 },
      issueCounts: { rsvp_status_missing: 1 },
      rawCounts: { attendance: 1, events: 5, people: 2, rsvps: 3 },
      schemaVersion: 1
    })
    expect(first.manifest.sources).toHaveLength(11)
    expect(first.bundleText).toMatch(/Comma, Newline\\nName/)
    expect(first.bundleText).not.toContain('This ignored field')

    const manifestText = JSON.stringify(first.manifest)
    for (const privateValue of [
      'person-1',
      'member-one@example.test',
      'Comma, Newline',
      'Synthetic event 1',
      'event-1',
      'session-1'
    ]) {
      expect(manifestText).not.toContain(privateValue)
    }
  })

  it('writes private outputs, emits a redacted receipt, and never overwrites them', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcu-solidarity-converter-'))
    try {
      const { arguments_: inputArguments, privateValues } = writeInputs(root, syntheticInputs())
      const bundlePath = join(root, 'bundle.json')
      const manifestPath = join(root, 'manifest.json')
      const commandArguments = [
        '--import',
        'tsx',
        'scripts/normalize-solidarity-events.ts',
        ...inputArguments,
        '--bundle',
        bundlePath,
        '--manifest',
        manifestPath
      ]

      const first = spawnSync(process.execPath, commandArguments, {
        cwd: repositoryRoot,
        encoding: 'utf8'
      })
      expect(first.status, first.stderr).toBe(0)
      expect(statSync(bundlePath).mode & 0o777).toBe(0o600)
      expect(statSync(manifestPath).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(bundlePath, 'utf8')).events).toHaveLength(5)
      expect(JSON.parse(first.stdout)).toMatchObject({
        bundleCounts: { events: 5, rsvps: 2 },
        issueCounts: { rsvp_status_missing: 1 }
      })
      for (const privateValue of privateValues) {
        expect(first.stdout).not.toContain(privateValue)
        expect(first.stderr).not.toContain(privateValue)
      }

      const before = readFileSync(bundlePath, 'utf8')
      const repeated = spawnSync(process.execPath, commandArguments, {
        cwd: repositoryRoot,
        encoding: 'utf8'
      })
      expect(repeated.status).toBe(1)
      expect(repeated.stderr).toBe('Solidarity report normalization failed (converter_failed).\n')
      expect(readFileSync(bundlePath, 'utf8')).toBe(before)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects mirrored RSVP and attendance subjects across an explicit hybrid session pair', () => {
    expect(() => convertSolidarityEventReports(hybridInputs('rsvp'))).toThrow(
      /duplicate normalized RSVP person\/session/
    )
    expect(() => convertSolidarityEventReports(hybridInputs('attendance'))).toThrow(
      /duplicate normalized attendance person\/session/
    )
  })

  it('quarantines only known recurring auto-RSVPs that have no occurrence', () => {
    const inputs = syntheticInputs()
    const sessionless = rsvpRow({
      id: 'sessionless-recurring-rsvp',
      sessionId: '',
      source: 'recurring_auto_rsvp',
      userId: 'person-1'
    }).map((value, index) => (sessionMetadataHeadersForTest.has(csvHeaders[index]!) ? '' : value))
    const firstReport = inputs.reports[0]!
    const converted = convertSolidarityEventReports({
      ...inputs,
      reports: [
        {
          ...firstReport,
          rsvps: bytes(csv([csvHeaders, sessionless]))
        },
        ...inputs.reports.slice(1)
      ]
    })

    expect(converted.bundle.rsvps.map(({ id }) => id)).toEqual(['rsvp-2'])
    expect(converted.manifest).toMatchObject({
      bundleCounts: { rsvps: 1 },
      issueCounts: { rsvp_session_missing: 1 },
      rawCounts: { rsvps: 2 }
    })

    const unexpectedSource = sessionless.map((value, index) =>
      index === csvHeaders.indexOf('Source') ? 'web_form' : value
    )
    expect(() =>
      convertSolidarityEventReports({
        ...inputs,
        reports: [{ ...firstReport, rsvps: bytes(csv([csvHeaders, unexpectedSource])) }, ...inputs.reports.slice(1)]
      })
    ).toThrow('Solidarity RSVP Session ID is required')

    for (const header of sessionMetadataHeadersForTest) {
      const unexpectedMetadata = sessionless.map((value, index) =>
        index === csvHeaders.indexOf(header) ? 'unexpected occurrence metadata' : value
      )
      expect(() =>
        convertSolidarityEventReports({
          ...inputs,
          reports: [{ ...firstReport, rsvps: bytes(csv([csvHeaders, unexpectedMetadata])) }, ...inputs.reports.slice(1)]
        })
      ).toThrow('Solidarity RSVP Session ID is required')
    }
  })

  it('rejects malformed cross-references without leaving either output behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcu-solidarity-converter-invalid-'))
    try {
      const inputs = syntheticInputs()
      const brokenReports = inputs.reports.map((report, index) =>
        index === 0
          ? {
              ...report,
              rsvps: bytes(
                csv([
                  csvHeaders,
                  rsvpRow({ id: 'private-rsvp-id', sessionId: 'session-1', userId: 'unknown-private-person' })
                ])
              )
            }
          : report
      )
      const { arguments_: inputArguments, privateValues } = writeInputs(root, {
        ...inputs,
        reports: brokenReports
      })
      const bundlePath = join(root, 'bundle.json')
      const manifestPath = join(root, 'manifest.json')
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/normalize-solidarity-events.ts',
          ...inputArguments,
          '--bundle',
          bundlePath,
          '--manifest',
          manifestPath
        ],
        { cwd: repositoryRoot, encoding: 'utf8' }
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toBe('Solidarity report normalization failed (converter_failed).\n')
      expect(() => statSync(bundlePath)).toThrow()
      expect(() => statSync(manifestPath)).toThrow()
      for (const privateValue of privateValues) {
        expect(result.stdout).not.toContain(privateValue)
        expect(result.stderr).not.toContain(privateValue)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('rejects oversized source reports before creating outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'wcu-solidarity-converter-oversized-'))
    try {
      const { arguments_: inputArguments, peoplePath } = writeInputs(root, syntheticInputs())
      truncateSync(peoplePath, 25 * 1024 * 1024 + 1)
      const bundlePath = join(root, 'bundle.json')
      const manifestPath = join(root, 'manifest.json')
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/normalize-solidarity-events.ts',
          ...inputArguments,
          '--bundle',
          bundlePath,
          '--manifest',
          manifestPath
        ],
        { cwd: repositoryRoot, encoding: 'utf8' }
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toBe('Solidarity report normalization failed (converter_failed).\n')
      expect(() => statSync(bundlePath)).toThrow()
      expect(() => statSync(manifestPath)).toThrow()
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})

function hybridInputs(activity: 'attendance' | 'rsvp') {
  const inputs = syntheticInputs()
  const report = inputs.reports[0]!
  const metadata = JSON.parse(new TextDecoder().decode(report.event)) as {
    attendance: Array<Record<string, unknown>>
    sessions: Array<Record<string, unknown>>
  }
  const primary = metadata.sessions[0]!
  primary.pairedSessionId = 'session-1-virtual'
  metadata.sessions.push({
    ...primary,
    eventType: 'virtual',
    id: 'session-1-virtual',
    locationAddress: null,
    locationName: null,
    pairedSessionId: 'session-1',
    primarySessionId: 'session-1',
    virtualUrl: 'https://meet.example.test/1'
  })
  if (activity === 'attendance') {
    metadata.attendance.push({
      ...metadata.attendance[0],
      id: 'attendance-mirror',
      sessionId: 'session-1-virtual'
    })
  }
  const rsvps =
    activity === 'rsvp'
      ? bytes(
          csv([
            csvHeaders,
            rsvpRow({ id: 'rsvp-1', sessionId: 'session-1', userId: 'person-1' }),
            rsvpRow({ id: 'rsvp-mirror', sessionId: 'session-1-virtual', userId: 'person-1' })
          ])
        )
      : report.rsvps
  return {
    ...inputs,
    reports: [{ event: bytes(JSON.stringify(metadata)), rsvps }, ...inputs.reports.slice(1)]
  }
}

function syntheticInputs() {
  const people = bytes(
    JSON.stringify([
      {
        email: 'member-one@example.test',
        first_name: 'Member',
        id: 'person-1',
        last_name: 'One',
        name: 'Member One',
        notes: 'This ignored field must never enter normalized output',
        phone_number: '+12095550101'
      },
      {
        email: 'member-two@example.test',
        first_name: 'Comma, Newline\nName',
        id: 'person-2',
        last_name: 'Two',
        name: 'Comma, Newline\nName Two',
        phone_number: '+12095550102'
      }
    ])
  )
  const reports = Array.from({ length: 5 }, (_, index) => {
    const ordinal = index + 1
    const eventId = `event-${ordinal}`
    const sessionId = `session-${ordinal}`
    const eventTags =
      ordinal === 1
        ? ['audience-public', 'category-meeting', 'meeting-general']
        : ordinal === 2
          ? ['audience-members', 'category-meeting', 'meeting-steering']
          : ['audience-public', 'category-social']
    const attendance =
      ordinal === 1
        ? [
            {
              checkedInAt: null,
              checkedOutAt: null,
              id: 'attendance-1',
              recordedAt: '2026-08-25T03:00:00.000Z',
              sessionId,
              status: 'attended',
              userId: 'person-1'
            }
          ]
        : []
    const rows: readonly (readonly string[])[] =
      ordinal === 1
        ? [
            csvHeaders,
            rsvpRow({ id: 'rsvp-1', sessionId, status: 'Yes', userId: 'person-1' }),
            rsvpRow({ id: 'rsvp-blank', sessionId, status: '', userId: 'person-2' })
          ]
        : ordinal === 2
          ? [
              csvHeaders,
              rsvpRow({
                id: 'rsvp-2',
                name: 'Comma, Newline\nName',
                sessionId,
                status: 'Maybe',
                updatedAt: '2026-08-23 19:02:03 -0700',
                userId: 'person-2'
              })
            ]
          : [csvHeaders]
    return {
      event: bytes(
        JSON.stringify({
          attendance,
          event: {
            campaignTags: [`campaign-${ordinal}`],
            description: null,
            eventPageUrl: `https://events.example.test/${ordinal}`,
            eventTags,
            id: eventId,
            primaryEventId: null,
            status: 'active',
            timezone: 'America/Los_Angeles',
            title: `Synthetic event ${ordinal}`
          },
          schemaVersion: 1,
          sessions: [
            {
              endsAt: `2026-09-0${ordinal}T03:00:00.000Z`,
              eventId,
              eventType: 'in_person',
              id: sessionId,
              locationAddress: '100 Example Street',
              locationName: 'Example Hall',
              pairedSessionId: null,
              primarySessionId: null,
              rsvpUrl: `https://events.example.test/${ordinal}`,
              startsAt: `2026-09-0${ordinal}T02:00:00.000Z`,
              status: 'scheduled',
              timezone: 'America/Los_Angeles',
              title: `Synthetic session ${ordinal}`,
              virtualUrl: null
            }
          ]
        })
      ),
      rsvps: bytes(csv(rows))
    }
  })
  return { people, reports }
}

function rsvpRow({
  id,
  name = 'Synthetic Name',
  sessionId,
  source = 'Event Page',
  status = 'Yes',
  updatedAt = '2026-08-23 18:02:03 -0700',
  userId
}: Readonly<{
  id: string
  name?: string
  sessionId: string
  source?: string
  status?: string
  updatedAt?: string
  userId: string
}>): readonly string[] {
  return [
    id,
    userId,
    name,
    'Synthetic Last',
    'private-row@example.test',
    '+12095550199',
    sessionId,
    'Synthetic session',
    '2026-09-01 19:00:00 -0700',
    '2026-09-01 20:00:00 -0700',
    'Example Hall - 100 Example Street',
    status,
    'true',
    source,
    '2026-08-23 17:02:03 -0700',
    updatedAt
  ]
}

const sessionMetadataHeadersForTest = new Set(['Session Title', 'Session Start', 'Session End', 'Session Location'])

function csv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function writeInputs(root: string, inputs: ReturnType<typeof syntheticInputs>) {
  const peoplePath = join(root, 'private-people.json')
  writeFileSync(peoplePath, inputs.people, { mode: 0o600 })
  const arguments_: string[] = ['--people', peoplePath]
  const privateValues = [peoplePath, 'member-one@example.test', 'person-1', 'Synthetic event 1']
  inputs.reports.forEach((report, index) => {
    const eventPath = join(root, `private-event-${index + 1}.json`)
    const rsvpPath = join(root, `private-rsvps-${index + 1}.csv`)
    writeFileSync(eventPath, report.event, { mode: 0o600 })
    writeFileSync(rsvpPath, report.rsvps, { mode: 0o600 })
    arguments_.push('--event', eventPath, '--rsvps', rsvpPath)
    privateValues.push(eventPath, rsvpPath)
  })
  return { arguments_, peoplePath, privateValues }
}
