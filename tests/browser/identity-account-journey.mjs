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
    await expect(page.getByRole('heading', { name: 'Welcome to Working Class Unity.' })).toBeVisible()
    await expect(
      page.getByText('The WCU website is being rebuilt. Create an account or log in with an email magic link.', {
        exact: true
      })
    ).toBeVisible()
    const getStarted = page.getByRole('link', { name: 'Create account', exact: true })
    await getStarted.focus()
    await expect(getStarted).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await expect(page.locator('.nuxt-route-announcer [role="status"]')).toHaveText('Sign up')
    await expect(page.getByText('Enter your email address to create or return to your account.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute('href', '/legal/terms')
    await expect(page.getByRole('link', { name: 'Privacy Policy', exact: true })).toHaveAttribute(
      'href',
      '/legal/privacy'
    )
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
    await helpers.assertAccessibleWithoutOverflow(page)

    await page.getByRole('link', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText('Enter your email address to receive a passwordless sign-in link.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send email link' })).toBeEnabled()

    await page.getByRole('link', { name: 'Privacy Policy', exact: true }).click()
    await expect(page).toHaveURL(/\/legal\/privacy$/)
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
    await expect(page.getByText(/customization prompt, not a production privacy policy/i)).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)

    await page.getByRole('link', { name: 'Sign up', exact: true }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await page.getByRole('link', { name: 'Terms', exact: true }).click()
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
    await expect(page.getByRole('heading', { name: 'Welcome to Working Class Unity.' })).toBeVisible()
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
