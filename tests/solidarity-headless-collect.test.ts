import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeSetCookies, readCookieJar, writeCookieJar } from '../scripts/lib/solidarity-cookies.mjs'
import { collectSolidarityCapture } from '../scripts/lib/solidarity-headless-collect.mjs'

const html = (body: string) => `<!DOCTYPE html><html><body>${body}</body></html>`
const origin = 'https://dashboard.solidarity.tech'
const publicOrigin = 'https://tech.workingclassunity.com'
const options = {
  from: '2026-09-01T07:00:00.000Z',
  to: '2026-10-01T07:00:00.000Z',
  timezone: 'America/Los_Angeles'
}

// Only vendor HTTP is substituted. The collector parses real, sanitized HTML shapes in a DOM.
const pages: Record<string, string> = {
  '/events': html(
    '<h2>All Events</h2><table data-data-table-target="dataTable" class="st-table"><tbody><tr><td><a href="/events/73">Meeting</a></td></tr></tbody></table>'
  ),
  '/events?state=past': html(
    '<h2>All Events</h2><table data-data-table-target="dataTable" class="st-table"><tbody></tbody></table>'
  ),
  '/events/73':
    html(`<h2 class="st-page-header--title"><span class="event-name editable" data-event-name="Meeting">Meeting</span></h2><a href="https://tech.workingclassunity.com/meeting">View event page</a>
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
const descriptionPage = html('<div class="content">Come organize with us.</div>')

const jar = {
  version: 1,
  updatedAt: null,
  cookies: [
    { name: 'remember_user_token', value: 'REMEMBER' },
    { name: '_stor-solidarity_session_production', value: 'SESSION' }
  ]
}

type JournalEntry = { url: string; cookie: string | null }

function fakeFetch(journal: JournalEntry[], overrides: Record<string, string> = {}) {
  return async (input: string | URL, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input))
    const headers = new Headers(init.headers as HeadersInit)
    journal.push({ url: url.href, cookie: headers.get('cookie') })
    if (url.origin === origin) {
      const page = { ...pages, ...overrides }[url.pathname + url.search]
      if (page === undefined) throw new Error('Unexpected vendor request')
      const responseHeaders: Record<string, string> = { 'content-type': 'text/html' }
      if (url.pathname === '/events/73/settings') {
        responseHeaders['set-cookie'] = 'remember_user_token=ROTATED; Path=/; HttpOnly'
      }
      return new Response(page, { headers: responseHeaders })
    }
    if (url.origin === publicOrigin && url.pathname === '/meeting') {
      return new Response(descriptionPage, { headers: { 'content-type': 'text/html' } })
    }
    throw new Error(`Unexpected request ${url.href}`)
  }
}

const directories: string[] = []
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'wcu-headless-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('headless Solidarity collection', () => {
  it('collects through the cookie jar, keeps cookies off public pages, and returns rotated sessions', async () => {
    const journal: JournalEntry[] = []
    const result = await collectSolidarityCapture({ jar, ...options, fetchImpl: fakeFetch(journal) })
    expect(result.capture.scope.eventIds).toEqual(['73'])
    expect(result.capture.scope.completeInventory).toBe(true)
    expect(result.capture.dataset.sessions).toHaveLength(2)
    expect(result.capture.dataset.events[0].description).toBe('Come organize with us.')
    expect(JSON.stringify(result.capture)).not.toContain('DO-NOT-COLLECT')
    const expected = 'remember_user_token=REMEMBER; _stor-solidarity_session_production=SESSION'
    const dashboard = journal.filter((entry) => entry.url.startsWith(origin))
    expect(dashboard.length).toBeGreaterThan(0)
    for (const entry of dashboard) {
      const beforeRotation = /\/events(?:\?state=past|\/73(?:\/settings)?)?$/.test(entry.url)
      expect(entry.cookie).toBe(
        beforeRotation ? expected : 'remember_user_token=ROTATED; _stor-solidarity_session_production=SESSION'
      )
    }
    const publicRequests = journal.filter((entry) => entry.url.startsWith(publicOrigin))
    expect(publicRequests).toEqual([{ url: `${publicOrigin}/meeting`, cookie: null }])
    expect(result.setCookieValues).toEqual(['remember_user_token=ROTATED; Path=/; HttpOnly'])
    const rotated = mergeSetCookies(jar, result.setCookieValues)
    expect(rotated.cookies).toEqual([
      { name: 'remember_user_token', value: 'ROTATED' },
      { name: '_stor-solidarity_session_production', value: 'SESSION' }
    ])
  })

  it('refuses a logged-out or incomplete dashboard response instead of returning a partial inventory', async () => {
    const journal: JournalEntry[] = []
    for (const response of ['<html><body>truncated', html('<form action="/login"><input type="password"></form>')]) {
      await expect(
        collectSolidarityCapture({
          jar,
          ...options,
          fetchImpl: fakeFetch(journal, { '/events/73/calendars/5012/edit': response })
        })
      ).rejects.toThrow(/^Solidarity dashboard:/)
    }
  })
})

describe('private cookie jar', () => {
  it('round-trips through a 0600 file and refuses looser permissions', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'cookies.json')
    writeCookieJar(path, jar)
    expect(readCookieJar(path).cookies).toEqual(jar.cookies)
    const loose = join(directory, 'loose.json')
    writeFileSync(loose, JSON.stringify(jar), { mode: 0o644 })
    expect(() => readCookieJar(loose)).toThrow(/mode 0600/)
  })

  it('rejects unexpected cookies and drops expired or revoked session cookies', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'cookies.json')
    writeFileSync(path, JSON.stringify({ version: 1, cookies: [{ name: 'intercom-session-x', value: 'y' }] }), {
      mode: 0o600
    })
    expect(() => readCookieJar(path)).toThrow(/unexpected cookie/)
    const merged = mergeSetCookies(jar, [
      'remember_user_token=NEW; Path=/',
      '_stor-solidarity_session_production=; Max-Age=0',
      'intercom-id-er96705e=ignored'
    ])
    expect(merged.cookies).toEqual([{ name: 'remember_user_token', value: 'NEW' }])
  })
})
