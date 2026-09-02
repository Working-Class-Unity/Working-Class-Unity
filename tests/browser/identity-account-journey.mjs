import { expect } from '@playwright/test'

export async function assertIdentityAccountJourney(context, helpers) {
  await assertPublicEntryAndLegalRoutes(context, helpers)
  await assertSignedOutAccountBoundary(context, helpers)
  await assertNotFoundRecovery(context, helpers)
}

async function assertPublicEntryAndLegalRoutes(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)

  try {
    await page.route('**/api/auth/get-session', (route) => helpers.fulfillJson(route, null))

    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.getByRole('heading', { name: 'Working People Need an Organization of Our Own' })).toBeVisible()
    await expect(
      page.getByText(
        'WCU is a member-run organization bringing working people together across San Joaquin County. We act collectively to win concrete changes, develop new leaders, and build lasting power.',
        { exact: true }
      )
    ).toBeVisible()
    if (await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
    }
    const getStarted = page.getByRole('link', { name: 'Get Involved', exact: true })
    await getStarted.focus()
    await expect(getStarted).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/#get-involved$/)
    await expect(page.getByRole('heading', { name: 'Start by showing up', exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)

    await page.goto('/join')
    await expect(page).toHaveURL(/\/join$/)
    await expect(page.getByRole('heading', { name: 'Join Working Class Unity' })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)

    if (await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
    }
    await page.getByRole('link', { name: 'Member Login', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(
      page.getByText('Use your email address or U.S. phone number to log in without a password.')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send email link' })).toBeEnabled()

    await page.getByRole('link', { name: 'Privacy Policy', exact: true }).click()
    await expect(page).toHaveURL(/\/legal\/privacy$/)
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
    await expect(page.getByText(/customization prompt, not a production privacy policy/i)).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)

    if (await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
    }
    await page.getByRole('link', { name: 'Get Involved', exact: true }).click()
    await expect(page).toHaveURL(/\/#get-involved$/)
    await expect(page.getByRole('heading', { name: 'Start by showing up', exact: true })).toBeVisible()
    await page.goto('/legal/terms')
    await expect(page).toHaveURL(/\/legal\/terms$/)
    await expect(page.getByRole('heading', { name: 'Terms', exact: true })).toBeVisible()
    await expect(page.getByText(/customization prompt, not production terms/i)).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertSignedOutAccountBoundary(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)

  try {
    const response = await page.goto('/account')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText('Browser Social User', { exact: true })).toHaveCount(0)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertNotFoundRecovery(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)

  try {
    const response = await page.goto('/missing-personal-app-page')

    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByText('The requested page could not be found.', { exact: true })).toBeVisible()
    await expect(page.getByText(/stack|exception|internal server/i)).toHaveCount(0)
    const recovery = page.getByRole('button', { name: 'Return home' })
    await recovery.focus()
    await expect(recovery).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Working People Need an Organization of Our Own' })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)

    observations.errorResponses = observations.errorResponses.filter(
      (entry) => !(entry.includes('GET 404') && entry.includes('/missing-personal-app-page'))
    )
    observations.console = observations.console.filter(
      (entry) => !/Failed to load resource: the server responded with a status of 404/.test(entry)
    )
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}
