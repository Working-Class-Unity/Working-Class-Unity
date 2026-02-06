import { describe, expect, it } from 'vitest'

import { campaigns, getCampaignBySlug } from '../../app/data/campaigns'
import { events, getEventsByCampaign, getEventsByType, getUpcomingEvents } from '../../app/data/events'
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
    const oneUpcomingEvent = getUpcomingEvents(1)
    const allUpcomingEvents = getUpcomingEvents()

    expect(oneUpcomingEvent.length).toBeLessThanOrEqual(1)

    const sorted = [...allUpcomingEvents].sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    expect(allUpcomingEvents).toEqual(sorted)
  })

  it('event ids are unique', () => {
    const ids = events.map((event) => event.id)
    expect(new Set(ids).size).toBe(ids.length)
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
