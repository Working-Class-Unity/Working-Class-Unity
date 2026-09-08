import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { petitionDemand } from '../../app/content/remove-flock-stockton/petition.ts'
import { readFileSync } from 'node:fs'

for (const locale of ['en', 'es', 'pa']) {
  for (const slug of ['what-stockton-bought', 'why-safeguards-are-not-enough', 'faq']) {
    test(`Flock supporting page ${slug} is accessible and reflows in ${locale}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${locale === 'en' ? '' : `/${locale}`}/campaigns/remove-flock-stockton/${slug}`)
      const article = page.locator('main article')
      await expect(article.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}`))
      await expect(article.locator('.campaign-editorial-reviewed, .campaign-faq-context')).toHaveCount(0)
      if (slug === 'faq') {
        const summary = article.locator('summary').first()
        await summary.focus()
        await page.keyboard.press('Enter')
        await expect(article.locator('details').first()).toHaveAttribute('open', '')
        await expect(article.locator('[role="doc-biblioref"]').first()).toBeVisible()
      }
      if (slug === 'why-safeguards-are-not-enough') {
        const demands =
          locale === 'en'
            ? petitionDemand.demands
            : JSON.parse(
                readFileSync(new URL(`../../i18n/locales/content/remove-flock/${locale}.json`, import.meta.url), 'utf8')
              ).localizedRemoveFlock.petitionDemand.demands
        await expect(article.locator('.safeguards-demands li')).toHaveText(demands)
      }
      for (const width of [1280, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 })
        await assertReflow(page)
      }
      const results = await new AxeBuilder({ page }).include('main article').analyze()
      expect(results.violations).toEqual([])
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      await assertReflow(page)
    })
  }
}

async function assertReflow(page) {
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}
