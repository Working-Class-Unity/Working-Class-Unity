export type CalendarViewId = 'agenda' | 'month'

export type CalendarEventCategory = 'action' | 'learning' | 'meeting' | 'social'
export type CalendarEventKind = 'Action' | 'Learning' | 'Meeting' | 'Social'
export type CalendarFilter = 'Everything' | CalendarEventKind

export type CalendarEvent = Readonly<{
  address: string
  campaignTags?: readonly string[]
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
    campaignTags?: readonly string[]
    description: string | null
    eventPageUrl: string | null
    id: string
    sessions: readonly Readonly<{
      campaignTags?: readonly string[]
      deliveryMode: 'hybrid' | 'in_person' | 'virtual'
      endsAt: string | null
      id: string
      locationAddress: string | null
      locationName: string | null
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

export const calendarCampaigns = [
  { id: 'all', label: 'all', tag: null, future: false },
  { id: 'united-front', label: 'unitedFront', tag: 'sidequest-2025-06-kyr', future: false },
  { id: 'deflock-stockton', label: 'deflockStockton', tag: 'sidequest-2026-03-deflock-stockton', future: false },
  { id: 'tenant-union', label: 'tenantUnion', tag: 'focus-tenant-union', future: true }
] as const
export type CalendarCampaignFilter = (typeof calendarCampaigns)[number]['id']
