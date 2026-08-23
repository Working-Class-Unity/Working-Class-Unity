export type CalendarViewId = 'agenda' | 'month'

export type CalendarEventCategory = 'action' | 'learning' | 'meeting' | 'social'
export type CalendarEventKind = 'Action' | 'Learning' | 'Meeting' | 'Social'
export type CalendarFilter = 'Everything' | CalendarEventKind

export type CalendarEvent = Readonly<{
  address: string
  dateLabel: string
  description: string
  endsAt: string | null
  eventPageUrl: string | null
  id: string
  kind: CalendarEventKind
  place: string
  recurring?: string
  rsvpUrl: string | null
  startsAt: string
  time: string
  timezone: string
  title: string
}>

export type CalendarApiResponse = Readonly<{
  events: readonly Readonly<{
    category: CalendarEventCategory
    description: string | null
    eventPageUrl: string | null
    id: string
    sessions: readonly Readonly<{
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
    }>[]
    title: string
  }>[]
}>

export type CalendarMonthCell = Readonly<{
  date: string
  day: string
  eventIds: readonly string[]
  outsideMonth: boolean
}>

export const calendarFilters = [
  'Everything',
  'Meeting',
  'Action',
  'Learning',
  'Social'
] as const satisfies readonly CalendarFilter[]
export const calendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const eventKindByCategory = Object.freeze({
  action: 'Action',
  learning: 'Learning',
  meeting: 'Meeting',
  social: 'Social'
} satisfies Record<CalendarEventCategory, CalendarEventKind>)
