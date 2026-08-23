import { createHash } from 'node:crypto'
import {
  assertSolidarityEventImportDataset,
  type SolidarityAttendanceRecord,
  type SolidarityEventImportDataset,
  type SolidarityEventRecord,
  type SolidarityPersonRecord,
  type SolidarityRsvpRecord,
  type SolidaritySessionRecord
} from './solidarity-import'

const requiredRsvpHeaders = ['RSVP ID', 'User ID', 'Session ID', 'RSVP Status', 'Created At', 'Updated At'] as const

type SourceBytes = Uint8Array

export type SolidarityEventReportInput = Readonly<{
  event: SourceBytes
  rsvps: SourceBytes
}>

export type SolidarityReportConversionInput = Readonly<{
  people: SourceBytes
  reports: readonly SolidarityEventReportInput[]
}>

export type SolidarityReportManifest = Readonly<{
  bundleCounts: Readonly<Record<keyof SolidarityEventImportDataset, number>>
  bundleSha256: string
  issueCounts: Readonly<Record<string, number>>
  rawCounts: Readonly<{ attendance: number; events: number; people: number; rsvps: number }>
  schemaVersion: 1
  sources: readonly Readonly<{ kind: 'event' | 'people' | 'rsvps'; ordinal: number; sha256: string }>[]
}>

export type SolidarityReportConversion = Readonly<{
  bundle: SolidarityEventImportDataset
  bundleText: string
  manifest: SolidarityReportManifest
  manifestText: string
}>

type EventMetadata = Readonly<{
  attendance: readonly SolidarityAttendanceRecord[]
  event: SolidarityEventRecord
  sessions: readonly SolidaritySessionRecord[]
}>

export function convertSolidarityEventReports(input: SolidarityReportConversionInput): SolidarityReportConversion {
  if (!input || typeof input !== 'object') throw new TypeError('Solidarity report conversion input is required')
  if (!Array.isArray(input.reports) || input.reports.length === 0) {
    throw new TypeError('At least one Solidarity event and RSVP report pair is required')
  }

  const peopleText = decodeUtf8(input.people)
  const people = parsePeople(peopleText)
  const personIds = new Set(people.map(({ id }) => String(id)))
  const events: SolidarityEventRecord[] = []
  const sessions: SolidaritySessionRecord[] = []
  const attendance: SolidarityAttendanceRecord[] = []
  const rsvps: SolidarityRsvpRecord[] = []
  const issueCodes: string[] = []
  const sources: Array<{ kind: 'event' | 'people' | 'rsvps'; ordinal: number; sha256: string }> = [
    { kind: 'people', ordinal: 1, sha256: sha256(input.people) }
  ]
  let rawRsvpCount = 0

  input.reports.forEach((report, index) => {
    if (!report || typeof report !== 'object') throw new TypeError('Solidarity report pair must be an object')
    const ordinal = index + 1
    const eventText = decodeUtf8(report.event)
    const rsvpText = decodeUtf8(report.rsvps)
    const metadata = parseEventMetadata(eventText)
    const eventId = String(metadata.event.id)
    const sessionIds = new Set(metadata.sessions.map(({ id }) => String(id)))

    if (metadata.sessions.some(({ eventId: sessionEventId }) => String(sessionEventId) !== eventId)) {
      throw new TypeError('Solidarity event metadata contains a session for another event')
    }
    for (const record of metadata.attendance) {
      if (!sessionIds.has(String(record.sessionId)) || !personIds.has(String(record.userId))) {
        throw new TypeError('Solidarity attendance metadata contains an unknown session or person')
      }
    }

    const rows = parseRsvpCsv(rsvpText)
    rawRsvpCount += rows.length
    for (const row of rows) {
      const id = requiredValue(row, 'RSVP ID')
      const sessionId = requiredValue(row, 'Session ID')
      const userId = requiredValue(row, 'User ID')
      if (!sessionIds.has(sessionId) || !personIds.has(userId)) {
        throw new TypeError('Solidarity RSVP report contains an unknown session or person')
      }
      const status = rsvpStatus(row['RSVP Status'])
      if (!status) {
        issueCodes.push('rsvp_status_missing')
        continue
      }
      const timestamp = clean(row['Updated At']) ?? requiredValue(row, 'Created At')
      rsvps.push(
        Object.freeze({
          id,
          respondedAt: solidarityTimestamp(timestamp),
          sessionId,
          status,
          userId
        })
      )
    }

    events.push(metadata.event)
    sessions.push(...metadata.sessions)
    attendance.push(...metadata.attendance)
    sources.push(
      { kind: 'event', ordinal, sha256: sha256(report.event) },
      { kind: 'rsvps', ordinal, sha256: sha256(report.rsvps) }
    )
  })

  const bundle = Object.freeze({
    attendance: Object.freeze(sortById(attendance)),
    events: Object.freeze(sortById(events)),
    people: Object.freeze(sortById(people)),
    rsvps: Object.freeze(sortById(rsvps)),
    sessions: Object.freeze(sortById(sessions))
  })
  assertSolidarityEventImportDataset(bundle)
  assertCrossReferences(bundle)

  const bundleText = `${JSON.stringify(bundle, null, 2)}\n`
  const manifest = Object.freeze({
    bundleCounts: Object.freeze({
      attendance: bundle.attendance.length,
      events: bundle.events.length,
      people: bundle.people.length,
      rsvps: bundle.rsvps.length,
      sessions: bundle.sessions.length
    }),
    bundleSha256: sha256(new TextEncoder().encode(bundleText)),
    issueCounts: Object.freeze(countIssues(issueCodes)),
    rawCounts: Object.freeze({
      attendance: attendance.length,
      events: events.length,
      people: people.length,
      rsvps: rawRsvpCount
    }),
    schemaVersion: 1 as const,
    sources: Object.freeze(sources.map((source) => Object.freeze(source)))
  })
  return Object.freeze({
    bundle,
    bundleText,
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`
  })
}

function parsePeople(text: string): readonly SolidarityPersonRecord[] {
  const value = parseJson(text, 'people')
  if (!Array.isArray(value)) throw new TypeError('Solidarity People report must be an array')
  return value.map((candidate) => {
    const person = record(candidate, 'person')
    return Object.freeze({
      displayName: optionalText(person.name, 320),
      email: optionalText(person.email, 320),
      firstName: optionalText(person.first_name, 320),
      id: externalId(person.id),
      lastName: optionalText(person.last_name, 320),
      phone: optionalText(person.phone_number, 320)
    })
  })
}

function parseEventMetadata(text: string): EventMetadata {
  const source = record(parseJson(text, 'event metadata'), 'event metadata')
  if (source.schemaVersion !== 1) throw new TypeError('Solidarity event metadata schemaVersion must be 1')
  if (!Array.isArray(source.sessions) || !Array.isArray(source.attendance)) {
    throw new TypeError('Solidarity event metadata sessions and attendance must be arrays')
  }
  const event = record(source.event, 'event metadata event')
  return Object.freeze({
    attendance: Object.freeze(
      source.attendance.map((candidate) => {
        const value = record(candidate, 'attendance metadata record')
        return Object.freeze({
          checkedInAt: optionalText(value.checkedInAt, 100),
          checkedOutAt: optionalText(value.checkedOutAt, 100),
          id: externalId(value.id),
          recordedAt: requiredText(value.recordedAt, 100),
          sessionId: externalId(value.sessionId),
          status: requiredText(value.status, 20) as SolidarityAttendanceRecord['status'],
          userId: externalId(value.userId)
        })
      })
    ),
    event: Object.freeze({
      campaignTags: stringArray(event.campaignTags),
      description: optionalText(event.description, 20_000),
      eventPageUrl: optionalText(event.eventPageUrl, 2_000),
      eventTags: stringArray(event.eventTags),
      id: externalId(event.id),
      primaryEventId: optionalExternalId(event.primaryEventId),
      status: requiredText(event.status, 20) as SolidarityEventRecord['status'],
      timezone: requiredText(event.timezone, 100),
      title: requiredText(event.title, 255)
    }),
    sessions: Object.freeze(
      source.sessions.map((candidate) => {
        const value = record(candidate, 'session metadata record')
        return Object.freeze({
          endsAt: optionalText(value.endsAt, 100),
          eventId: externalId(value.eventId),
          eventType: requiredText(value.eventType, 20) as SolidaritySessionRecord['eventType'],
          id: externalId(value.id),
          locationAddress: optionalText(value.locationAddress, 2_000),
          locationName: optionalText(value.locationName, 500),
          pairedSessionId: optionalExternalId(value.pairedSessionId),
          primarySessionId: optionalExternalId(value.primarySessionId),
          rsvpUrl: optionalText(value.rsvpUrl, 2_000),
          startsAt: requiredText(value.startsAt, 100),
          status: requiredText(value.status, 20) as SolidaritySessionRecord['status'],
          timezone: requiredText(value.timezone, 100),
          title: optionalText(value.title, 255),
          virtualUrl: optionalText(value.virtualUrl, 2_000)
        })
      })
    )
  })
}

function parseRsvpCsv(text: string): readonly Readonly<Record<string, string>>[] {
  const rows = parseCsv(text)
  const headers = rows.shift()
  if (!headers) throw new TypeError('Solidarity RSVP report is empty')
  if (headers[0]?.startsWith('\uFEFF')) headers[0] = headers[0].slice(1)
  if (new Set(headers).size !== headers.length || requiredRsvpHeaders.some((header) => !headers.includes(header))) {
    throw new TypeError('Solidarity RSVP report headers are not supported')
  }
  return rows
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => {
      if (values.length !== headers.length) throw new TypeError('Solidarity RSVP report row has the wrong field count')
      return Object.freeze(
        Object.fromEntries(headers.map((header, index) => [header, values[index]!])) as Record<string, string>
      )
    })
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let fieldStarted = false
  let quoted = false
  let quoteClosed = false
  let row: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        quoteClosed = true
      } else {
        field += character
      }
      continue
    }
    if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n') {
      throw new TypeError('Solidarity RSVP report contains characters after a closing quote')
    }
    if (character === '"') {
      if (fieldStarted) throw new TypeError('Solidarity RSVP report contains an unexpected quote')
      quoted = true
      fieldStarted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
      fieldStarted = false
      quoteClosed = false
    } else if (character === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStarted = false
      quoteClosed = false
    } else if (character !== '\r') {
      field += character
      fieldStarted = true
    } else if (text[index + 1] !== '\n') {
      throw new TypeError('Solidarity RSVP report contains an unsupported line ending')
    }
  }
  if (quoted) throw new TypeError('Solidarity RSVP report contains an unterminated quote')
  if (fieldStarted || quoteClosed || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function solidarityTimestamp(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/)
  if (!match) throw new TypeError('Solidarity RSVP timestamp format is not supported')
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, sign, offsetHourText, offsetMinuteText] =
    match
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText
  ].map(Number)
  const localMilliseconds = Date.UTC(year!, month! - 1, day, hour, minute, second)
  const local = new Date(localMilliseconds)
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month! - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    offsetHour! > 23 ||
    offsetMinute! > 59
  ) {
    throw new TypeError('Solidarity RSVP timestamp is invalid')
  }
  const offset = (offsetHour! * 60 + offsetMinute!) * (sign === '+' ? 1 : -1)
  return new Date(localMilliseconds - offset * 60_000).toISOString()
}

function rsvpStatus(value: unknown): SolidarityRsvpRecord['status'] | null {
  const normalized = clean(value)?.toLowerCase()
  if (!normalized) return null
  if (normalized === 'cancelled') return 'canceled'
  if (['canceled', 'maybe', 'no', 'waitlisted', 'yes'].includes(normalized)) {
    return normalized as SolidarityRsvpRecord['status']
  }
  throw new TypeError('Solidarity RSVP status is not supported')
}

function assertCrossReferences(bundle: SolidarityEventImportDataset): void {
  const eventIds = new Set(bundle.events.map(({ id }) => String(id)))
  const sessionIds = new Set(bundle.sessions.map(({ id }) => String(id)))
  const personIds = new Set(bundle.people.map(({ id }) => String(id)))
  if (bundle.sessions.some(({ eventId }) => !eventIds.has(String(eventId)))) {
    throw new TypeError('Solidarity bundle contains a session for an unknown event')
  }
  if (
    [...bundle.rsvps, ...bundle.attendance].some(
      ({ sessionId, userId }) => !sessionIds.has(String(sessionId)) || !personIds.has(String(userId))
    )
  ) {
    throw new TypeError('Solidarity bundle contains activity for an unknown session or person')
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new TypeError(`Solidarity ${label} is not valid JSON`)
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Solidarity ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError('Solidarity event tags must be arrays')
  return Object.freeze(value.map((item) => requiredText(item, 100)))
}

function externalId(value: unknown): string {
  return requiredText(typeof value === 'number' ? String(value) : value, 255)
}

function optionalExternalId(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : externalId(value)
}

function requiredValue(row: Readonly<Record<string, string>>, key: string): string {
  const value = clean(row[key])
  if (!value) throw new TypeError(`Solidarity RSVP ${key} is required`)
  return value
}

function requiredText(value: unknown, maximumLength: number): string {
  const normalized = clean(value)
  if (!normalized || normalized.length > maximumLength) throw new TypeError('Solidarity report text is invalid')
  return normalized
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, maximumLength)
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function sortById<T extends Readonly<{ id: string | number }>>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function countIssues(codes: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const code of [...codes].sort()) counts[code] = (counts[code] ?? 0) + 1
  return counts
}

function decodeUtf8(value: unknown): string {
  if (!(value instanceof Uint8Array)) throw new TypeError('Solidarity report source must contain bytes')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new TypeError('Solidarity report source must be valid UTF-8')
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
