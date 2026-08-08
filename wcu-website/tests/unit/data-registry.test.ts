import { describe, expect, it } from 'vitest'

import { campaigns, getCampaignBySlug } from '../../app/data/campaigns'
import {
  events,
  getEventsByCampaign,
  getEventsByType,
  getUpcomingEvents,
  isEventVisible,
} from '../../app/data/events'
import { handbookChapterMap, handbookChapters, handbookContacts, handbookQuickPaths } from '../../app/data/tenant-handbook'

describe('Campaign registry', () => {
  it('returns known campaign by slug', () => {
    const campaign = getCampaignBySlug('tenant-union')

    expect(campaign).toBeDefined()
    expect(campaign?.id).toBe('campaign-1')
  })

  it('campaign ids are unique', () => {
    const ids = campaigns.map((campaign) => campaign.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('Event registry', () => {
  it('filters by event type', () => {
    const meetings = getEventsByType('meeting')

    expect(meetings.length).toBeGreaterThan(0)
    expect(meetings.every((event) => event.eventType === 'meeting')).toBe(true)
  })

  it('links events to campaigns', () => {
    const linkedEvents = getEventsByCampaign('campaign-3')

    expect(linkedEvents.length).toBeGreaterThan(0)
    expect(linkedEvents.every((event) => event.campaignId === 'campaign-3')).toBe(true)
  })

  it('returns sorted upcoming events and applies limit', () => {
    const referenceTime = new Date('2026-02-27T05:00:00.000Z')
    const oneUpcomingEvent = getUpcomingEvents(1, referenceTime)
    const allUpcomingEvents = getUpcomingEvents(undefined, referenceTime)

    expect(oneUpcomingEvent.length).toBeLessThanOrEqual(1)

    const sorted = [...allUpcomingEvents].sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    expect(allUpcomingEvents).toEqual(sorted)
  })

  it('keeps events visible for 3 hours after they end', () => {
    const recentEvent = events.find((event) => event.id === 'event-28')

    expect(recentEvent).toBeDefined()
    expect(isEventVisible(recentEvent!, '2026-04-10T05:59:59.000Z')).toBe(true)
    expect(isEventVisible(recentEvent!, '2026-04-10T06:00:01.000Z')).toBe(false)
  })

  it('event ids are unique', () => {
    const ids = events.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the published Coffee with WCU recurring schedule', () => {
    const coffeeEvents = events
      .filter((event) => event.titleKey === 'calendar.events.coffeeWithWcuSeries.title')
      .filter((event) => event.startDateTime >= '2026-08-15')

    expect(coffeeEvents.map(({ startDateTime, endDateTime }) => [startDateTime, endDateTime])).toEqual([
      ['2026-08-15T17:00:00.000Z', '2026-08-15T18:30:00.000Z'],
      ['2026-09-12T17:00:00.000Z', '2026-09-12T18:30:00.000Z'],
      ['2026-10-10T17:00:00.000Z', '2026-10-10T18:30:00.000Z'],
      ['2026-11-14T18:00:00.000Z', '2026-11-14T19:30:00.000Z'],
      ['2026-12-12T18:00:00.000Z', '2026-12-12T19:30:00.000Z'],
    ])
    expect(coffeeEvents.every((event) => event.isActive)).toBe(true)
  })

  it('stores the updated Lodi Game Night and Farmers Market events', () => {
    const gameNight = events.find((event) => event.id === 'event-21')
    expect(gameNight).toMatchObject({
      startDateTime: '2026-08-29T00:30:00.000Z',
      endDateTime: '2026-08-29T02:00:00.000Z',
      location: 'Side Hustle Brew - 2441 S Stockton St Ste 1, Lodi, CA 95240, USA',
      rsvpLink: 'https://maps.app.goo.gl/qur1NseMzjnrBFU7A',
      isActive: true,
    })

    const farmersMarket = events.find((event) => event.id === 'event-80')
    expect(farmersMarket).toMatchObject({
      titleKey: 'calendar.events.farmersMarketTabling.title',
      eventType: 'action',
      startDateTime: '2026-08-29T02:00:00.000Z',
      endDateTime: '2026-08-29T03:30:00.000Z',
      location: 'Lodi Farmers Market - 502 E Lodi Ave, Lodi, CA 95240, USA',
      rsvpLink: 'https://maps.app.goo.gl/y8e2wrB7bEBQE8UM6',
      isActive: true,
    })
  })
})

describe('Tenant handbook registry', () => {
  it('quick paths and contacts remain populated', () => {
    expect(handbookQuickPaths.length).toBeGreaterThan(0)
    expect(handbookContacts.length).toBeGreaterThan(0)
  })

  it('chapter map keys match chapters', () => {
    const chapterIds = handbookChapters.map((chapter) => chapter.id)

    for (const chapterId of chapterIds) {
      expect(handbookChapterMap[chapterId]).toBeDefined()
    }
  })
})
