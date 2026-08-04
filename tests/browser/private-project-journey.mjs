import { expect } from '@playwright/test'

const initialProjectName =
  'A deliberately long private project name that wraps cleanly without exposing another family member'
const renamedProjectName = 'A renamed private project'

export async function assertPrivateProjectJourney(context, helpers) {
  await assertProjectLifecycle(context, helpers)
  await assertInitialProjectSessionLoss(context, helpers)
  await assertSessionLossClearsProjects(context, helpers)
}

export async function assertRealProjectSuccessJourney(page, helpers, suffix) {
  const projectName = `Packaged private project ${suffix}`
  const renamedName = `Packaged renamed project ${suffix}`

  await page.waitForLoadState('networkidle')
  const collectionResponse = await page.goto('/app/projects')
  if (!collectionResponse) throw new Error('Project collection navigation returned no document response')
  expect(collectionResponse.status()).toBe(200)
  expect(collectionResponse.headers()['cache-control']).toBe('private, no-store')
  expect((await collectionResponse.text()).includes('No projects yet')).toBe(true)
  await expect(page).toHaveURL(/\/app\/projects$/)
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()

  await page.getByRole('textbox', { name: 'Project name' }).fill(projectName)
  await page.getByRole('button', { name: 'Create project' }).click()
  const projectLink = page.getByRole('link', { name: projectName, exact: true })
  await expect(projectLink).toBeFocused()
  const projectHref = await projectLink.getAttribute('href')
  if (!projectHref) throw new Error('Created project did not expose its immutable-ID route')

  await page.waitForLoadState('networkidle')
  const detailResponse = await page.goto(projectHref)
  if (!detailResponse) throw new Error('Project detail navigation returned no document response')
  expect(detailResponse.status()).toBe(200)
  expect(detailResponse.headers()['cache-control']).toBe('private, no-store')
  expect((await detailResponse.text()).includes(projectName)).toBe(true)

  await expect(page).toHaveURL(/\/app\/projects\/project_/)
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  const renameInput = page.getByRole('textbox', { name: 'Project name' })
  await renameInput.fill(renamedName)
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Project name updated.', { exact: true })).toBeFocused()
  await expect(page.getByRole('heading', { name: renamedName, exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(page.getByText(`Permanently delete ${renamedName}?`, { exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page).toHaveURL(/\/app\/projects$/)
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()
  await helpers.assertAccessibleWithoutOverflow(page)
}

async function assertProjectLifecycle(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const projects = []
  const commands = []
  const fixture = {
    id: 'project_browser-private',
    name: initialProjectName,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z'
  }
  let listRelease
  let createRelease
  let detailRelease
  let renameRelease
  let deleteRelease
  let listAttempt = 0
  let createAttempt = 0
  let renameAttempt = 0
  let deleteAttempt = 0

  try {
    await installSignedInSession(page, helpers)
    await page.route('**/api/projects**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())

      if (request.method() === 'GET' && url.pathname === '/api/projects') {
        listAttempt += 1
        if (listAttempt === 1) {
          await new Promise((resolve) => {
            listRelease = resolve
          })
        }
        if (listAttempt <= 2) {
          return fulfillFailure(route, 503)
        }
        return helpers.fulfillJson(route, { projects })
      }

      if (request.method() === 'POST' && url.pathname === '/api/projects') {
        createAttempt += 1
        commands.push({ method: 'POST', body: request.postDataJSON() })
        if (createAttempt === 1) {
          await new Promise((resolve) => {
            createRelease = resolve
          })
          return fulfillFailure(route, 503)
        }
        projects.unshift(fixture)
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ project: fixture })
        })
      }

      if (url.pathname === `/api/projects/${fixture.id}` && request.method() === 'GET') {
        if (!detailRelease) {
          await new Promise((resolve) => {
            detailRelease = resolve
          })
        }
        return helpers.fulfillJson(route, { project: fixture })
      }

      if (url.pathname === `/api/projects/${fixture.id}` && request.method() === 'PATCH') {
        renameAttempt += 1
        commands.push({ method: 'PATCH', body: request.postDataJSON() })
        if (renameAttempt === 1) {
          await new Promise((resolve) => {
            renameRelease = resolve
          })
          return fulfillFailure(route, 503)
        }
        fixture.name = request.postDataJSON().name
        fixture.updatedAt = '2026-07-13T12:05:00.000Z'
        return helpers.fulfillJson(route, { project: fixture })
      }

      if (url.pathname === `/api/projects/${fixture.id}` && request.method() === 'DELETE') {
        deleteAttempt += 1
        commands.push({ method: 'DELETE', body: request.postData() })
        if (deleteAttempt === 1) {
          await new Promise((resolve) => {
            deleteRelease = resolve
          })
          return fulfillFailure(route, 503)
        }
        projects.splice(0, projects.length)
        return helpers.fulfillJson(route, { status: 'deleted' })
      }

      return route.fallback()
    })

    await page.goto('/')
    const projectsLink = page.getByRole('link', { name: 'Projects', exact: true })
    await expect(projectsLink).toBeVisible()
    await projectsLink.click()
    await expect(page.getByText('Loading projects', { exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    await expect.poll(() => typeof listRelease).toBe('function')
    listRelease()
    await expect(page.getByText('Projects unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText('We could not load your projects right now.', { exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    const collectionRetry = page.getByRole('button', { name: 'Retry' })
    await collectionRetry.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()
    await expectSingleCurrentNavigation(page, 'Projects')
    await helpers.assertAccessibleWithoutOverflow(page)

    const createInput = page.getByRole('textbox', { name: 'Project name' })
    await createInput.fill('   ')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('Enter a project name.', { exact: true })).toBeVisible()
    await expect(createInput).toBeFocused()
    expect(commands).toEqual([])

    await createInput.fill(initialProjectName)
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('button', { name: 'Creating...' })).toBeDisabled()
    await expect.poll(() => typeof createRelease).toBe('function')
    createRelease()
    await expect(page.getByRole('alert')).toHaveText('We could not create the project. Please try again.')
    await expect(page.getByRole('alert')).toBeFocused()

    await page.getByRole('button', { name: 'Create project' }).click()
    const createdLink = page.getByRole('link', { name: initialProjectName, exact: true })
    await expect(createdLink).toBeFocused()
    await expect(page.getByText(`${initialProjectName} was created.`, { exact: true })).toBeVisible()
    expect(commands.slice(0, 2)).toEqual([
      { method: 'POST', body: { name: initialProjectName } },
      { method: 'POST', body: { name: initialProjectName } }
    ])

    await page.setViewportSize({ width: 320, height: 800 })
    await helpers.assertNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await helpers.assertNoHorizontalOverflow(page)
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('font-size')
    })
    await page.setViewportSize({ width: 390, height: 844 })

    await createdLink.press('Enter')
    await expect(page.getByText('Loading project', { exact: true })).toBeVisible()
    await expect.poll(() => typeof detailRelease).toBe('function')
    detailRelease()
    await expect(page.getByRole('heading', { name: initialProjectName, exact: true })).toBeVisible()
    await expectSingleCurrentNavigation(page, 'Projects')

    const renameInput = page.getByRole('textbox', { name: 'Project name' })
    await renameInput.fill(' ')
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByText('Enter a project name.', { exact: true })).toBeVisible()
    await expect(renameInput).toBeFocused()

    await renameInput.fill(renamedProjectName)
    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    await expect.poll(() => typeof renameRelease).toBe('function')
    renameRelease()
    await expect(page.getByRole('alert')).toHaveText('We could not update the project. Please try again.')
    await expect(page.getByRole('alert')).toBeFocused()

    await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByText('Project name updated.', { exact: true })).toBeFocused()
    await expect(page.getByRole('heading', { name: renamedProjectName, exact: true })).toBeVisible()

    await page.setViewportSize({ width: 320, height: 800 })
    const deleteTrigger = page.getByRole('button', { name: 'Delete project', exact: true })
    await deleteTrigger.focus()
    await page.keyboard.press('Enter')
    const confirmation = page.getByText(`Permanently delete ${renamedProjectName}?`, { exact: true })
    await expect(confirmation).toBeFocused()
    await helpers.assertAccessibleWithoutOverflow(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(deleteTrigger).toBeFocused()

    await deleteTrigger.click()
    await page.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(page.getByRole('button', { name: 'Deleting...' })).toBeDisabled()
    await expect.poll(() => typeof deleteRelease).toBe('function')
    deleteRelease()
    await expect(page.getByRole('alert')).toContainText('We could not confirm deletion.')
    await expect(page.getByRole('alert')).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`/app/projects/${fixture.id}$`))

    await page.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(page).toHaveURL(/\/app\/projects$/)
    await expect(page.getByText('No projects yet', { exact: true })).toBeVisible()
    expect(commands.slice(2)).toEqual([
      { method: 'PATCH', body: { name: renamedProjectName } },
      { method: 'PATCH', body: { name: renamedProjectName } },
      { method: 'DELETE', body: null },
      { method: 'DELETE', body: null }
    ])

    helpers.removeExpectedHttpFailure(observations, 'GET', 503, '/api/projects', 2)
    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/projects')
    helpers.removeExpectedHttpFailure(observations, 'PATCH', 503, `/api/projects/${fixture.id}`)
    helpers.removeExpectedHttpFailure(observations, 'DELETE', 503, `/api/projects/${fixture.id}`)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertSessionLossClearsProjects(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  let sessionActive = true
  const staleName = 'Private data that must disappear'

  try {
    await installSignedInSession(page, helpers, () => sessionActive)
    await page.route('**/api/projects**', async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        return helpers.fulfillJson(route, {
          projects: [
            {
              id: 'project_stale',
              name: staleName,
              createdAt: '2026-07-13T12:00:00.000Z',
              updatedAt: '2026-07-13T12:00:00.000Z'
            }
          ]
        })
      }
      sessionActive = false
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusMessage: 'Authentication required' })
      })
    })

    await page.goto('/')
    await page.getByRole('link', { name: 'Projects', exact: true }).click()
    await expect(page.getByText(staleName, { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Project name' }).fill('Session loss probe')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText(staleName, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0)

    helpers.removeExpectedHttpFailure(observations, 'POST', 401, '/api/projects')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertInitialProjectSessionLoss(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  let sessionActive = true

  try {
    await installSignedInSession(page, helpers, () => sessionActive)
    await page.route('**/api/projects**', async (route) => {
      sessionActive = false
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusMessage: 'Authentication required' })
      })
    })

    await page.goto('/')
    await page.getByRole('link', { name: 'Projects', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0)

    helpers.removeExpectedHttpFailure(observations, 'GET', 401, '/api/projects')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function installSignedInSession(page, helpers, sessionState = () => true) {
  const now = new Date().toISOString()
  await page.route('**/api/baseline', (route) =>
    helpers.fulfillJson(route, { socialProviders: { google: 'disabled' } })
  )
  await page.route('**/api/auth/get-session', (route) => {
    if (!sessionState()) return helpers.fulfillJson(route, null)
    return helpers.fulfillJson(route, {
      session: {
        id: 'browser-project-session',
        token: 'browser-project-session-token',
        userId: 'browser-project-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: 'family-plan-must-not-authorize-projects'
      },
      user: {
        id: 'browser-project-user',
        name: 'Browser Project User',
        email: 'browser.projects@example.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now
      }
    })
  })
}

async function expectSingleCurrentNavigation(page, label) {
  const primary = page.getByRole('navigation', { name: 'Primary' })
  await expect(primary.locator('[aria-current="page"]')).toHaveCount(1)
  await expect(primary.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
}

function fulfillFailure(route, status) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ statusMessage: 'Injected project failure' })
  })
}
