import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'

test('United Front remains accessible at a narrow viewport', async ({ page }) => {
  await page.goto('/campaigns/united-front')
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
})

test('Events navigation shows the next three public sessions with working destination fallbacks', async ({ page }) => {
  const sqlite = new Database(process.env.BROWSER_RUNTIME_DATABASE_PATH, { fileMustExist: true })
  const dateAfter = (days) => new Date(Date.now() + days * 86_400_000).toISOString()
  try {
    sqlite
      .prepare(
        `insert into events (id, title, kind, visibility, event_page_url) values
      ('navigation-series', 'Navigation recurring action', 'action', 'public', 'https://example.test/series'),
      ('navigation-first', 'Navigation first action', 'action', 'public', 'https://example.test/event'),
      ('navigation-calendar', 'Navigation calendar action', 'action', 'public', null),
      ('navigation-members', 'Navigation member-only action', 'meeting', 'members', null),
      ('navigation-hidden', 'Navigation hidden action', 'social', 'hidden', null)`
      )
      .run()
    const insert = sqlite.prepare(`insert into event_sessions
      (id, event_id, status, delivery_mode, starts_at, timezone, rsvp_url)
      values (?, ?, ?, 'in_person', ?, 'America/Los_Angeles', ?)`)
    for (const [id, eventId, status, days, rsvp] of [
      ['series-later', 'series', 'scheduled', 28, null],
      ['series-next', 'series', 'scheduled', 14, null],
      ['first', 'first', 'scheduled', 7, 'https://example.test/rsvp'],
      ['calendar', 'calendar', 'scheduled', 21, null],
      ['members', 'members', 'scheduled', 1, null],
      ['hidden', 'hidden', 'scheduled', 2, null],
      ['completed', 'first', 'completed', 3, null],
      ['canceled', 'first', 'canceled', 4, null]
    ]) {
      insert.run(`navigation-${id}`, `navigation-${eventId}`, status, dateAfter(days), rsvp)
    }

    await page
      .context()
      .addCookies([{ name: 'navigation-test-cookie', value: 'public-only', url: process.env.BROWSER_BASE_URL }])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
      if (width < 1000) await page.getByRole('button', { name: 'Menu', exact: true }).click()
      const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
      const eventRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/events')
      await navigation.getByRole('button', { name: 'Events', exact: true }).click()
      expect((await (await eventRequest).allHeaders()).cookie).toBeUndefined()
      const entries = navigation.getByRole('link', { name: /^Navigation / })
      await expect(entries).toHaveCount(3)
      await expect(entries.nth(0)).toHaveAccessibleName('Navigation first action')
      await expect(entries.nth(0)).toHaveAttribute('href', 'https://example.test/rsvp')
      await expect(entries.nth(1)).toHaveAccessibleName('Navigation recurring action')
      await expect(entries.nth(1)).toHaveAttribute('href', 'https://example.test/series')
      await expect(entries.nth(2)).toHaveAccessibleName('Navigation calendar action')
      await expect(entries.nth(2)).toHaveAttribute('href', '/calendar')
      await expect(entries.locator('time')).toHaveCount(3)
      await expect(navigation.getByRole('link', { name: 'All events', exact: true })).toHaveAttribute(
        'href',
        '/calendar'
      )
      if (width > 1000) {
        await navigation.getByRole('button', { name: 'Events', exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(entries.nth(0)).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await expect(navigation.getByRole('button', { name: 'Events', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        for (const index of [0, 1, 2]) {
          await expect(entries.nth(index)).toBeFocused()
          await page.keyboard.press('Tab')
        }
        await expect(navigation.getByRole('link', { name: 'All events', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeFocused()
        await navigation.getByRole('button', { name: 'Events', exact: true }).click()
        await expect(entries).toHaveCount(3)
      }
      // Reka's hidden focus proxy is outside the desktop panel. Exercise its
      // Tab routing above; run Axe on the actual panel and the full mobile header.
      const accessibility = await new AxeBuilder({ page })
        .include(width > 1000 ? '.topbar-events-menu' : '.topbar')
        .analyze()
      expect(accessibility.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: width > 1000 ? 'Events' : 'Menu', exact: true })).toBeFocused()
    }
  } finally {
    sqlite.prepare("delete from event_sessions where event_id like 'navigation-%'").run()
    sqlite.prepare("delete from events where id like 'navigation-%'").run()
    sqlite.close()
  }

  await page.goto('/')
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await navigation.getByRole('button', { name: 'Events', exact: true }).click()
  await expect(navigation.getByText('No upcoming events are published yet.', { exact: true })).toBeVisible()
  await expect(navigation.getByRole('link', { name: /^Navigation / })).toHaveCount(0)
  await navigation.getByRole('link', { name: 'All events', exact: true }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute('aria-expanded', 'false')
})

test('Events navigation reopens immediately after keyboard dismissal during the hover delay', async ({ page }) => {
  const pauseAt = new Date(Date.now() + 60_000)
  await page.clock.install()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  const events = navigation.getByRole('button', { name: 'Events', exact: true })
  await expect(events).toBeVisible()
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  await page.clock.pauseAt(pauseAt)

  await events.hover()
  await page.clock.runFor(200)
  await expect(events).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'All events', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(events).toHaveAttribute('aria-expanded', 'false')
  await expect(events).toBeFocused()

  // Reopen before the original 300 ms hover guard expires.
  await events.click()
  await expect(events).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'All events', exact: true })).toBeVisible()
  await page.clock.runFor(300)
  await events.click()
  await expect(events).toHaveAttribute('aria-expanded', 'false')

  const currentWork = navigation.getByRole('button', { name: 'Current Work', exact: true })
  await currentWork.hover()
  await page.clock.runFor(200)
  await expect(currentWork).toHaveAttribute('aria-expanded', 'true')
  await expect(events).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Escape')
  await expect(currentWork).toHaveAttribute('aria-expanded', 'false')
  await expect(currentWork).toBeFocused()
})

test('Events navigation keeps the calendar reachable when the public feed fails', async ({ page }) => {
  // A network fixture is necessary to exercise an unavailable API; the content
  // and visibility checks above use the real database and endpoint.
  await page.route('**/api/events', (route) => route.fulfill({ status: 503, json: { message: 'Unavailable' } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await navigation.getByRole('button', { name: 'Events', exact: true }).click()
  await expect(navigation.getByText('We couldn’t load the calendar.', { exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  await navigation.getByRole('link', { name: 'All events', exact: true }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(navigation.getByRole('button', { name: 'Events', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
})

test('Calendar preserves occurrence titles and chronology in agenda and month views', async ({ page }) => {
  const sqlite = new Database(process.env.BROWSER_RUNTIME_DATABASE_PATH, { fileMustExist: true })
  const starts = [7, 14, 21, 28].map((days) => new Date(Date.now() + days * 86_400_000).toISOString())
  const titles = [
    'Special: Deflock Stockton Organizing Meeting',
    'Deflock outreach: first session',
    'Deflock outreach: second session',
    null
  ]
  const displayedTitles = titles.map((title) => title ?? 'Layout series B')
  try {
    sqlite
      .prepare(
        `insert into events (id, title, kind, visibility) values
      ('layout-series-a', 'Layout series A', 'social', 'public'),
      ('layout-series-b', 'Layout series B', 'social', 'public')`
      )
      .run()
    const insert = sqlite.prepare(`insert into event_sessions
      (id, event_id, status, delivery_mode, starts_at, timezone, title)
      values (?, ?, 'scheduled', 'hybrid', ?, 'America/Los_Angeles', ?)`)
    for (const [index, startsAt] of starts.entries()) {
      insert.run(
        `layout-session-${index}`,
        index % 2 === 0 ? 'layout-series-a' : 'layout-series-b',
        startsAt,
        titles[index]
      )
    }
    await page.goto('/calendar')
    await expect(page.locator('.featured-event time')).toHaveAttribute('datetime', starts[0])
    await expect(page.locator('#up-next-title')).toHaveText('Up next')
    const dates = await page
      .locator('.event-list time')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')))
    expect(dates).toEqual(starts.slice(1))
    await expect(page.locator('.featured-event h3')).toHaveText(displayedTitles[0])
    await expect(page.locator('.event-list h4')).toHaveText(displayedTitles.slice(1))
    await expect(page.locator('.series-item h4')).toHaveText(displayedTitles.slice(0, 2))
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    for (const title of displayedTitles) {
      const occurrence = page.locator('.calendar-event').filter({ hasText: title })
      if ((await occurrence.count()) === 0) {
        await page.getByRole('button', { name: 'Next month', exact: true }).click()
      }
      await expect(occurrence).toHaveText(title)
      await occurrence.click()
      await expect(page.locator('#selected-event-title')).toHaveText(title)
    }
  } finally {
    sqlite.prepare("delete from event_sessions where event_id in ('layout-series-a', 'layout-series-b')").run()
    sqlite.prepare("delete from events where id in ('layout-series-a', 'layout-series-b')").run()
    sqlite.close()
  }
})
