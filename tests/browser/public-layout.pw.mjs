import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'

test('United Front keeps its contrast, reading column, and logo bounds in production', async ({ page }) => {
  await page.goto('/campaigns/united-front')
  const pledge = page.getByRole('heading', { name: 'OUR PLEDGE', exact: true })
  await expect(pledge).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(page.locator('#united-front-pledge')).toHaveCSS('background-color', 'rgb(4, 51, 79)')

  const heading = await page.locator('#what-we-face-title').boundingBox()
  const copy = await page.locator('#united-front-what-we-face .united-front-copy').boundingBox()
  expect(copy.x).toBeCloseTo(heading.x, 0)
  expect(copy.y).toBeGreaterThanOrEqual(heading.y + heading.height)

  const image = page.locator('.united-front-endorser-logo img').first()
  await image.scrollIntoViewIfNeeded()
  const imageBounds = await image.boundingBox()
  const logoBounds = await page.locator('.united-front-endorser-logo').first().boundingBox()
  expect(imageBounds.height).toBeLessThanOrEqual(logoBounds.height + 1)
  expect(imageBounds.width).toBeLessThanOrEqual(logoBounds.width + 1)

  const actions = await page.locator('.united-front-signing-path .app-action-link').all()
  const first = await actions[0].boundingBox()
  const second = await actions[1].boundingBox()
  if (second.x > first.x + first.width) {
    expect(second.y + second.height).toBeCloseTo(first.y + first.height, 0)
  } else {
    expect(second.y).toBeGreaterThan(first.y + first.height)
  }

  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Events' }).click()
  await expect(page).toHaveURL(/\/calendar$/)
  await page.goBack()
  await expect(pledge).toHaveCSS('color', 'rgb(255, 255, 255)')
})

test('Calendar interleaves recurring series chronologically without a false month label', async ({ page }) => {
  const sqlite = new Database(process.env.BROWSER_RUNTIME_DATABASE_PATH, { fileMustExist: true })
  const starts = [7, 14, 21, 28].map((days) => new Date(Date.now() + days * 86_400_000).toISOString())
  try {
    sqlite
      .prepare(
        `insert into events (id, title, kind, visibility) values
      ('layout-series-a', 'Layout series A', 'social', 'public'),
      ('layout-series-b', 'Layout series B', 'social', 'public')`
      )
      .run()
    const insert = sqlite.prepare(`insert into event_sessions
      (id, event_id, status, delivery_mode, starts_at, timezone)
      values (?, ?, 'scheduled', 'in_person', ?, 'America/Los_Angeles')`)
    for (const [index, startsAt] of starts.entries()) {
      insert.run(`layout-session-${index}`, index % 2 === 0 ? 'layout-series-a' : 'layout-series-b', startsAt)
    }
    await page.goto('/calendar')
    await expect(page.locator('.featured-event time')).toHaveAttribute('datetime', starts[0])
    await expect(page.locator('#up-next-title')).toHaveText('Up next')
    const dates = await page
      .locator('.event-list time')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')))
    expect(dates).toEqual(starts.slice(1))
  } finally {
    sqlite.prepare("delete from event_sessions where event_id in ('layout-series-a', 'layout-series-b')").run()
    sqlite.prepare("delete from events where id in ('layout-series-a', 'layout-series-b')").run()
    sqlite.close()
  }
})
