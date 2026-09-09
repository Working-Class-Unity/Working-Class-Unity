import { publicLocales } from '#shared/public-site'

export default defineNuxtPlugin({
  name: 'utility-locale',
  enforce: 'pre',
  setup(nuxtApp) {
    nuxtApp.hook('i18n:beforeLocaleSwitch', async (event) => {
      if (!event.initialSetup || nuxtApp.$router.currentRoute.value.meta.i18n !== false) return

      // Public URLs select their language; unprefixed account/utility routes
      // keep the existing saved-language and browser-language behavior.
      const preference = await nuxtApp.runWithContext(() => useCookieLocale().value || useBrowserLocale())
      const preferredLocale = publicLocales.find((locale) => locale.code === preference)
      if (preferredLocale) event.newLocale = preferredLocale.code
    })
  }
})
