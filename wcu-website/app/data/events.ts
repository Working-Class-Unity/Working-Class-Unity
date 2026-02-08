/**
 * Events Data Registry
 *
 * This file serves as the single source of truth for all calendar event data.
 * It follows the centralized data registry pattern established in campaigns.ts
 * and know-your-rights.ts for consistency.
 */

export type EventType = 'meeting' | 'action' | 'training' | 'social' | 'canvass' | 'forum' | 'other'
export type Committee = 'membership' | 'education' | 'treasurer' | null

export interface Event {
  id: string
  titleKey: string // i18n key for title
  descriptionKey: string // i18n key for description
  eventType: EventType
  startDateTime: string // ISO date string
  endDateTime: string // ISO date string
  allDay: boolean
  location: string
  rsvpLink: string | null
  isVirtual: boolean
  isHybrid: boolean
  isActive: boolean
  createdAt: string // ISO date string
  updatedAt: string // ISO date string
  campaignId: string | null // links to campaign.id from campaigns.ts
  committee: Committee
}

export const events: Event[] = [
  {
    id: 'event-1',
    titleKey: 'calendar.events.generalMeeting.title',
    descriptionKey: 'calendar.events.generalMeeting.description',
    eventType: 'meeting',
    startDateTime: '2025-12-05T02:00:00.000Z',
    endDateTime: '2025-12-05T03:30:00.000Z',
    allDay: false,
    location: '2522 Grand Canal Boulevard Suite # 6, Stockton, CA 95207, USA',
    rsvpLink: 'https://tech.workingclassunity.com/wcu-general-meeting',
    isVirtual: false,
    isHybrid: true,
    isActive: true,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    campaignId: null,
    committee: null
  },
  {
    id: 'event-2',
    titleKey: 'calendar.events.fightTheFearCanvassing.title',
    descriptionKey: 'calendar.events.fightTheFearCanvassing.description',
    eventType: 'canvass',
    startDateTime: '2025-12-06T20:00:00.000Z',
    endDateTime: '2025-12-06T22:30:00.000Z',
    allDay: false,
    location: '2522 Grand Canal Boulevard Suite # 6, Stockton, CA 95207, USA',
    rsvpLink: null,
    isVirtual: false,
    isHybrid: false,
    isActive: true,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    campaignId: 'campaign-3',
    committee: null
  },
  {
    id: 'event-3',
    titleKey: 'calendar.events.fightTheFearCanvassing.title',
    descriptionKey: 'calendar.events.fightTheFearCanvassing.description',
    eventType: 'canvass',
    startDateTime: '2025-12-07T23:00:00.000Z',
    endDateTime: '2025-12-08T01:30:00.000Z',
    allDay: false,
    location: '2522 Grand Canal Boulevard Suite # 6, Stockton, CA 95207, USA',
    rsvpLink: null,
    isVirtual: false,
    isHybrid: false,
    isActive: true,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    campaignId: 'campaign-3',
    committee: null
  },
  {
    id: 'event-4',
    titleKey: 'calendar.events.kyrCommunityForum.title',
    descriptionKey: 'calendar.events.kyrCommunityForum.description',
    eventType: 'forum',
    startDateTime: '2025-12-20T23:00:00.000Z',
    endDateTime: '2025-12-21T01:30:00.000Z',
    allDay: false,
    location: '2522 Grand Canal Boulevard Suite # 6, Stockton, CA 95207, USA',
    rsvpLink: null,
    isVirtual: false,
    isHybrid: false,
    isActive: true,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    campaignId: 'campaign-3',
    committee: null
  },
  {
    id: 'event-5',
    titleKey: 'calendar.events.generalMeeting.title',
    descriptionKey: 'calendar.events.generalMeeting.description',
    eventType: 'meeting',
    startDateTime: '2026-02-06T02:00:00.000Z',
    endDateTime: '2026-02-06T03:30:00.000Z',
    allDay: false,
    location: 'OF Hall - 2522 Grand Canal Blvd, Stockton, CA, USA',
    rsvpLink: 'https://tech.workingclassunity.com/wcu-general-meeting',
    isVirtual: false,
    isHybrid: true,
    isActive: true,
    createdAt: '2026-02-05T03:26:38.000Z',
    updatedAt: '2026-02-05T03:26:38.000Z',
    campaignId: null,
    committee: null
  },
  {
    id: 'event-6',
    titleKey: 'calendar.events.steeringCommitteeMeetingFeb9.title',
    descriptionKey: 'calendar.events.steeringCommitteeMeetingFeb9.description',
    eventType: 'meeting',
    startDateTime: '2026-02-10T02:00:00.000Z',
    endDateTime: '2026-02-10T03:00:00.000Z',
    allDay: false,
    location: 'Virtual (Zoom)',
    rsvpLink: 'https://us06web.zoom.us/j/5652383072?pwd=gU8B9xXHTxuRapRkX6vpxBTVLGLzfi.1',
    isVirtual: true,
    isHybrid: false,
    isActive: true,
    createdAt: '2026-02-08T00:32:42.779Z',
    updatedAt: '2026-02-08T00:32:42.779Z',
    campaignId: null,
    committee: null
  },
  {
    id: 'event-7',
    titleKey: 'calendar.events.coffeeWithWcu.title',
    descriptionKey: 'calendar.events.coffeeWithWcu.description',
    eventType: 'social',
    startDateTime: '2026-02-14T18:00:00.000Z',
    endDateTime: '2026-02-14T19:00:00.000Z',
    allDay: false,
    location: 'The Well - 1200 N Center St, Stockton, CA 95202, USA',
    rsvpLink: 'https://maps.app.goo.gl/tyLTA6sBFj8pYdg37',
    isVirtual: false,
    isHybrid: false,
    isActive: true,
    createdAt: '2026-02-08T00:32:42.779Z',
    updatedAt: '2026-02-08T00:32:42.779Z',
    campaignId: null,
    committee: 'membership'
  },
  {
    id: 'event-8',
    titleKey: 'calendar.events.steeringCommitteeMeetingFeb19.title',
    descriptionKey: 'calendar.events.steeringCommitteeMeetingFeb19.description',
    eventType: 'meeting',
    startDateTime: '2026-02-20T02:00:00.000Z',
    endDateTime: '2026-02-20T03:00:00.000Z',
    allDay: false,
    location: 'Virtual (Zoom)',
    rsvpLink: 'https://us06web.zoom.us/j/5652383072?pwd=gU8B9xXHTxuRapRkX6vpxBTVLGLzfi.1',
    isVirtual: true,
    isHybrid: false,
    isActive: true,
    createdAt: '2026-02-08T00:32:42.779Z',
    updatedAt: '2026-02-08T00:32:42.779Z',
    campaignId: null,
    committee: null
  },
  {
    id: 'event-9',
    titleKey: 'calendar.events.socialism101ReadingGroup.title',
    descriptionKey: 'calendar.events.socialism101ReadingGroup.description',
    eventType: 'training',
    startDateTime: '2026-03-05T04:00:00.000Z',
    endDateTime: '2026-03-05T05:00:00.000Z',
    allDay: false,
    location: 'Location TBD (Stockton, CA)',
    rsvpLink: null,
    isVirtual: false,
    isHybrid: false,
    isActive: true,
    createdAt: '2026-02-08T00:32:42.779Z',
    updatedAt: '2026-02-08T00:32:42.779Z',
    campaignId: null,
    committee: 'education'
  }
]

/**
 * Get a single event by its ID
 * @param id - The unique identifier for the event
 * @returns The event object or undefined if not found
 */
export function getEventById(id: string): Event | undefined {
  return events.find((event) => event.id === id)
}

/**
 * Get all events associated with a specific campaign
 * @param campaignId - The campaign ID to filter by
 * @returns Array of events linked to the campaign
 */
export function getEventsByCampaign(campaignId: string): Event[] {
  return events.filter((event) => event.campaignId === campaignId)
}

/**
 * Get all events associated with a specific committee
 * @param committee - The committee to filter by
 * @returns Array of events for the specified committee
 */
export function getEventsByCommittee(committee: string): Event[] {
  return events.filter((event) => event.committee === committee)
}

/**
 * Get upcoming active events sorted by start date/time
 * @param limit - Optional maximum number of events to return
 * @returns Array of active events sorted by startDateTime, optionally limited
 */
export function getUpcomingEvents(limit?: number): Event[] {
  const now = new Date().toISOString()
  const upcomingEvents = events
    .filter((event) => event.isActive && event.startDateTime >= now)
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))

  if (limit !== undefined && limit > 0) {
    return upcomingEvents.slice(0, limit)
  }

  return upcomingEvents
}

/**
 * Get all events of a specific type
 * @param eventType - The event type to filter by
 * @returns Array of events matching the specified type
 */
export function getEventsByType(eventType: string): Event[] {
  return events.filter((event) => event.eventType === eventType)
}

export default events
