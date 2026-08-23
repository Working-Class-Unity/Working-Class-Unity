export type CalendarViewId = 'agenda' | 'month'

export type CalendarEventKind = 'Organizing' | 'Action' | 'Community' | 'Training'

export type CalendarFilter = 'Everything' | CalendarEventKind

export type CalendarEvent = Readonly<{
  id: string
  title: string
  kind: CalendarEventKind
  dateLabel: string
  startsAt: string
  time: string
  place: string
  address: string
  description: string
  discussionUrl?: string
  recurring?: string
}>

export type CalendarMonthCell = Readonly<{
  day: string
  outsideMonth: boolean
  eventIds: readonly string[]
}>

export const calendarFilters = [
  'Everything',
  'Organizing',
  'Action',
  'Community',
  'Training'
] as const satisfies readonly CalendarFilter[]

export const calendarEvents = [
  {
    id: 'general-meeting',
    title: 'WCU General Meeting',
    kind: 'Organizing',
    dateLabel: 'Thu, Aug 20',
    startsAt: '2026-08-20T19:00:00-07:00',
    time: '7:00–8:30 PM',
    place: 'OF Hall',
    address: '2522 Grand Canal Blvd, Stockton, CA',
    description:
      'Our monthly open organizing meeting for campaign decisions, political discussion, and member work. Newcomers are welcome.',
    discussionUrl: '#',
    recurring: 'Third Thursday monthly · 4 more dates'
  },
  {
    id: 'canvass',
    title: 'Tenant rights canvass',
    kind: 'Action',
    dateLabel: 'Sat, Aug 22',
    startsAt: '2026-08-22T10:00:00-07:00',
    time: '10:00 AM–1:00 PM',
    place: 'Victory Park',
    address: '1001 N Pershing Ave, Stockton, CA',
    description: 'Knock doors with experienced organizers and talk with tenants about repairs and rent increases.',
    discussionUrl: '#'
  },
  {
    id: 'game-night',
    title: 'WCU game night',
    kind: 'Community',
    dateLabel: 'Fri, Aug 28',
    startsAt: '2026-08-28T17:30:00-07:00',
    time: '5:30–7:00 PM',
    place: 'Side Hustle Brew',
    address: '2441 S Stockton St, Lodi, CA',
    description: 'Bring a game or join a table. Food is available from Side Hustle Brew.'
  },
  {
    id: 'tabling',
    title: 'Farmers market tabling',
    kind: 'Action',
    dateLabel: 'Fri, Aug 28',
    startsAt: '2026-08-28T19:00:00-07:00',
    time: '7:00–8:30 PM',
    place: 'Lodi Farmers Market',
    address: '502 E Lodi Ave, Lodi, CA',
    description: 'Talk with neighbors about WCU and invite people into upcoming campaigns.'
  },
  {
    id: 'coffee',
    title: 'Coffee with WCU',
    kind: 'Community',
    dateLabel: 'Sat, Sep 12',
    startsAt: '2026-09-12T10:00:00-07:00',
    time: '10:00–11:30 AM',
    place: 'Groundstack Coffee',
    address: '3210 Pacific Ave, Stockton, CA',
    description: 'An informal morning to meet WCU organizers, ask questions, and get connected.',
    recurring: 'Second Saturday monthly · 4 more dates'
  }
] as const satisfies readonly CalendarEvent[]

export const calendarWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const calendarMonthCells = [
  { day: '26', outsideMonth: true, eventIds: [] },
  { day: '27', outsideMonth: true, eventIds: [] },
  { day: '28', outsideMonth: true, eventIds: [] },
  { day: '29', outsideMonth: true, eventIds: [] },
  { day: '30', outsideMonth: true, eventIds: [] },
  { day: '31', outsideMonth: true, eventIds: [] },
  { day: '1', outsideMonth: false, eventIds: [] },
  { day: '2', outsideMonth: false, eventIds: [] },
  { day: '3', outsideMonth: false, eventIds: [] },
  { day: '4', outsideMonth: false, eventIds: [] },
  { day: '5', outsideMonth: false, eventIds: [] },
  { day: '6', outsideMonth: false, eventIds: [] },
  { day: '7', outsideMonth: false, eventIds: [] },
  { day: '8', outsideMonth: false, eventIds: [] },
  { day: '9', outsideMonth: false, eventIds: [] },
  { day: '10', outsideMonth: false, eventIds: [] },
  { day: '11', outsideMonth: false, eventIds: [] },
  { day: '12', outsideMonth: false, eventIds: [] },
  { day: '13', outsideMonth: false, eventIds: [] },
  { day: '14', outsideMonth: false, eventIds: [] },
  { day: '15', outsideMonth: false, eventIds: [] },
  { day: '16', outsideMonth: false, eventIds: [] },
  { day: '17', outsideMonth: false, eventIds: [] },
  { day: '18', outsideMonth: false, eventIds: [] },
  { day: '19', outsideMonth: false, eventIds: [] },
  { day: '20', outsideMonth: false, eventIds: ['general-meeting'] },
  { day: '21', outsideMonth: false, eventIds: [] },
  { day: '22', outsideMonth: false, eventIds: ['canvass'] },
  { day: '23', outsideMonth: false, eventIds: [] },
  { day: '24', outsideMonth: false, eventIds: [] },
  { day: '25', outsideMonth: false, eventIds: [] },
  { day: '26', outsideMonth: false, eventIds: [] },
  { day: '27', outsideMonth: false, eventIds: [] },
  { day: '28', outsideMonth: false, eventIds: ['game-night', 'tabling'] },
  { day: '29', outsideMonth: false, eventIds: [] },
  { day: '30', outsideMonth: false, eventIds: [] },
  { day: '31', outsideMonth: false, eventIds: [] },
  { day: '1', outsideMonth: true, eventIds: [] },
  { day: '2', outsideMonth: true, eventIds: [] },
  { day: '3', outsideMonth: true, eventIds: [] },
  { day: '4', outsideMonth: true, eventIds: [] },
  { day: '5', outsideMonth: true, eventIds: [] }
] as const satisfies readonly CalendarMonthCell[]
