import { Window } from 'happy-dom'
import { expect, it } from 'vitest'
import { collectSolidarityDashboardEvents } from '../scripts/lib/solidarity-dashboard.mjs'

const html = (body: string) => `<!DOCTYPE html><html><body>${body}</body></html>`
const origin = 'https://dashboard.solidarity.tech'
const options = { from: '2026-09-01T07:00:00.000Z', to: '2026-10-01T07:00:00.000Z', timezone: 'America/Los_Angeles' }
// Only vendor HTTP is substituted. The collector parses real, sanitized HTML shapes in a browser DOM.
const pages: Record<string, string> = {
  '/events': html(
    '<h2>All Events</h2><table data-data-table-target="dataTable" class="st-table"><tbody><tr><td><a href="/events/73">Meeting</a></td></tr></tbody></table>'
  ),
  '/events?state=past': html(
    '<h2>All Events</h2><table data-data-table-target="dataTable" class="st-table"><tbody></tbody></table>'
  ),
  '/events/73':
    html(`<h2 data-event-name="Meeting">Meeting</h2><a href="https://tech.workingclassunity.com/meeting">View event page</a>
    <div id="event_schedule">${['5011', '5012']
      .map(
        (id) => `<turbo-frame id="edit_calendar_item_${id}">
      <time datetime="2026-10-10T01:00:00Z"></time><time datetime="2026-10-10T02:00:00Z"></time>
      <div class="calendar_item_location">${id === '5011' ? 'Hall' : 'Virtual Event'}</div>
      <a href="/events/73/calendars/${id}/edit">Edit</a></turbo-frame>`
      )
      .join('')}</div>`),
  '/events/73/settings': html(`<form action="/events/73/settings"><select multiple name="tags[]">
    <option selected value="audience-public">audience-public</option><option selected value="category-social">category-social</option>
    </select><select multiple name="campaign_tags[]"></select><input name="authenticity_token" value="DO-NOT-COLLECT"></form>`),
  ...Object.fromEntries(
    ['5011', '5012'].map((id) => [
      `/events/73/calendars/${id}/edit`,
      html(`<form action="/events/73/calendars/${id}">
    <input name="meci[title]" value="Meet our neighbors"><input name="meci[start_time]" data-flatpickr-default-date="1791594000000">
    <input name="meci[end_time]" data-flatpickr-default-date="1791597600000">
    <select name="meci[paired_meci_id]"><option selected value="${id === '5011' ? '5012' : '5011'}">Pair</option></select>
    ${id === '5011' ? '<input name="meci[location_name]" value="Hall"><input name="address[full_address]" value="100 Main St">' : '<input name="meci[location_address]" value="https://meet.example.test/meeting">'}
    </form>`)
    ])
  )
}

async function capture(overrides: Record<string, string> = {}) {
  const window = new Window({
    url: origin,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true }
  })
  Object.assign(window, {
    fetch: async (input: unknown, init: RequestInit) => {
      const url = new URL(String(input))
      expect(url.origin).toBe(origin)
      expect(init.method).toBe('GET')
      const page = { ...pages, ...overrides }[url.pathname + url.search]
      if (page === undefined) throw new Error('Unexpected vendor request')
      return new Response(page, { headers: { 'content-type': 'text/html' } })
    }
  })
  try {
    return await window.eval(`(${collectSolidarityDashboardEvents.toString()})(${JSON.stringify(options)})`)
  } finally {
    await window.happyDOM.close()
  }
}

it('captures identities and complete hybrid metadata, including a reschedule outside the selected month, without authentication data', async () => {
  const result = await capture()
  expect(result.scope.eventIds).toEqual(['73'])
  expect(result.dataset.events[0].eventTags).toEqual(['audience-public', 'category-social'])
  expect(result.dataset.sessions).toHaveLength(2)
  expect(result.dataset.sessions[0]).toMatchObject({
    id: '5011',
    pairedSessionId: '5012',
    eventType: 'in_person',
    startsAt: '2026-10-10T01:00:00.000Z'
  })
  expect(result.dataset.sessions[1]).toMatchObject({ id: '5012', pairedSessionId: '5011', eventType: 'virtual' })
  expect([result.dataset.people, result.dataset.rsvps, result.dataset.attendance]).toEqual([[], [], []])
  expect(JSON.stringify(result)).not.toContain('DO-NOT-COLLECT')
})

it('refuses an incomplete or logged-out response instead of returning a partial inventory', async () => {
  for (const response of ['<html><body>truncated', html('<form action="/login"><input type="password"></form>')]) {
    await expect(capture({ '/events/73/calendars/5012/edit': response })).rejects.toThrow(/^Solidarity dashboard:/)
  }
})
