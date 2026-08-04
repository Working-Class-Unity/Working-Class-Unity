import { expect } from '@playwright/test'

const projectFixtures = [
  project('project_foreign', 'Foreign project fixture'),
  project(' ', 'Malformed project fixture')
]

export async function assertProjectBoundaryJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)

  try {
    await installSignedInSession(page, helpers)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/projects**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname === '/api/projects') {
        return helpers.fulfillJson(route, { projects: projectFixtures })
      }

      if (request.method() !== 'GET') return route.fallback()
      const id = decodeURIComponent(url.pathname.slice('/api/projects/'.length))
      if (id === 'project_foreign') return fulfillFailure(route, 404)
      if (id === ' ') return fulfillFailure(route, 400)
      return route.fallback()
    })

    await page.goto('/')
    await page.getByRole('link', { name: 'Projects', exact: true }).click()
    await expect(page.getByText('Foreign project fixture', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Foreign project fixture', exact: true }).click()
    const foreignPresentation = await assertConcealedUnavailable(page, helpers)
    await page.getByRole('link', { name: 'Return to projects' }).press('Enter')

    await page.getByRole('link', { name: 'Malformed project fixture', exact: true }).click()
    const malformedPresentation = await assertConcealedUnavailable(page, helpers)
    expect(malformedPresentation).toBe(foreignPresentation)
    await page.getByRole('link', { name: 'Return to projects' }).click()

    helpers.removeExpectedHttpFailure(observations, 'GET', 404, '/api/projects/project_foreign')
    helpers.removeExpectedHttpFailure(observations, 'GET', 400, '/api/projects/%20')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertConcealedUnavailable(page, helpers) {
  await expect(page.getByRole('heading', { name: 'Project', exact: true })).toBeVisible()
  await expect(page.getByText('Project unavailable', { exact: true })).toBeVisible()
  await expect(
    page.getByText('This project does not exist or is not available to your account.', { exact: true })
  ).toBeVisible()
  const recovery = page.getByRole('link', { name: 'Return to projects' })
  await recovery.focus()
  await expect(recovery).toBeFocused()
  await helpers.assertAccessibleWithoutOverflow(page)
  return page.locator('.state-block').innerText()
}

async function installSignedInSession(page, helpers) {
  const now = new Date().toISOString()
  await page.route('**/api/baseline', (route) =>
    helpers.fulfillJson(route, { socialProviders: { google: 'disabled' } })
  )
  await page.route('**/api/auth/get-session', (route) =>
    helpers.fulfillJson(route, {
      session: {
        id: 'browser-project-boundary-session',
        token: 'browser-project-boundary-token',
        userId: 'browser-project-boundary-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: 'family-plan-not-project-authority'
      },
      user: {
        id: 'browser-project-boundary-user',
        name: 'Browser Project Boundary User',
        email: 'browser.project-boundary@example.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now
      }
    })
  )
}

function project(id, name) {
  return {
    id,
    name,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z'
  }
}

function fulfillFailure(route, status) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ statusMessage: 'Injected project lookup failure' })
  })
}
