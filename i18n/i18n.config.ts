export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'en',
  datetimeFormats: {
    en: {
      invitationLocal: {
        dateStyle: 'medium',
        timeStyle: 'short'
      },
      invitationUtc: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short'
      }
    }
  }
}))
