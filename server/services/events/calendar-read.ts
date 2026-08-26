import type { DatabaseConnection } from '../../db/connect'
import type { EventCategory } from '../../db/schema/events'
import type { BillingStripePriceConfiguration } from '../payments/stripe/configuration'
import { readWebsiteMembershipAccess } from '../membership/member-access'

export type CalendarEvent = Readonly<{
  category: EventCategory
  description: string | null
  eventPageUrl: string | null
  id: string
  sessions: readonly CalendarEventSession[]
  title: string
}>

export type CalendarEventSession = Readonly<{
  deliveryMode: 'hybrid' | 'in_person' | 'virtual'
  endsAt: string | null
  id: string
  locationAddress: string | null
  locationName: string | null
  meetingKind: 'general' | 'steering' | null
  rsvpUrl: string | null
  startsAt: string
  status: 'completed' | 'scheduled'
  timezone: string
  title: string | null
}>

type CalendarRow = Readonly<{
  category: EventCategory
  deliveryMode: CalendarEventSession['deliveryMode']
  description: string | null
  endsAt: string | null
  eventId: string
  eventPageUrl: string | null
  eventTitle: string
  locationAddress: string | null
  locationName: string | null
  meetingKind: CalendarEventSession['meetingKind']
  rsvpUrl: string | null
  sessionId: string
  sessionTitle: string | null
  startsAt: string
  status: CalendarEventSession['status']
  timezone: string
}>

export function listVisibleCalendarEvents(
  connection: DatabaseConnection,
  input: Readonly<{
    from: string
    limit: number
    now: Date
    prices: BillingStripePriceConfiguration
    to: string
    userId: string | null
  }>
): Readonly<{ events: readonly CalendarEvent[] }> {
  const from = canonicalUtcTimestamp(input.from, 'Calendar from')
  const to = canonicalUtcTimestamp(input.to, 'Calendar to')
  if (to <= from) throw new TypeError('Calendar to must be after from')
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new TypeError('Calendar limit must be an integer from 1 to 200')
  }
  const canViewMemberEvents = input.userId
    ? readWebsiteMembershipAccess(connection, input.userId, input.prices, input.now).granted
    : false
  const rows = connection.sqlite
    .prepare(
      `select e.id as eventId, e.title as eventTitle, e.description, e.kind as category,
              e.event_page_url as eventPageUrl, s.id as sessionId, s.title as sessionTitle,
              s.status, s.delivery_mode as deliveryMode, s.starts_at as startsAt,
              s.ends_at as endsAt, s.timezone, s.location_name as locationName,
              s.location as locationAddress, s.rsvp_url as rsvpUrl, m.kind as meetingKind
       from events e
       join event_sessions s on s.event_id = e.id
       left join meetings m on m.event_session_id = s.id
       where e.status = 'active' and s.status in ('scheduled', 'completed')
         and s.starts_at >= ? and s.starts_at < ?
         and (e.visibility = 'public' or (? = 1 and e.visibility = 'members'))
       order by s.starts_at, e.title, s.id
       limit ?`
    )
    .all(from, to, canViewMemberEvents ? 1 : 0, input.limit) as CalendarRow[]

  const events = new Map<string, CalendarEvent & { sessions: CalendarEventSession[] }>()
  for (const row of rows) {
    const existing = events.get(row.eventId)
    const event =
      existing ??
      ({
        category: row.category,
        description: row.description,
        eventPageUrl: row.eventPageUrl,
        id: row.eventId,
        sessions: [],
        title: row.eventTitle
      } satisfies CalendarEvent & { sessions: CalendarEventSession[] })
    event.sessions.push(
      Object.freeze({
        deliveryMode: row.deliveryMode,
        endsAt: row.endsAt,
        id: row.sessionId,
        locationAddress: row.locationAddress,
        locationName: row.locationName,
        meetingKind: row.meetingKind,
        rsvpUrl: row.rsvpUrl,
        startsAt: row.startsAt,
        status: row.status,
        timezone: row.timezone,
        title: row.sessionTitle
      })
    )
    if (!existing) events.set(row.eventId, event)
  }
  return Object.freeze({
    events: Object.freeze(
      [...events.values()].map((event) => Object.freeze({ ...event, sessions: Object.freeze(event.sessions) }))
    )
  })
}

function canonicalUtcTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`)
  }
  return value
}
