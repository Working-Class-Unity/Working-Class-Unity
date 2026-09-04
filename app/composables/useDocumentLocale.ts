export function useDocumentLocale() {
  const { locale, localeProperties } = useI18n()

  useHead(() => ({
    htmlAttrs: {
      dir: localeProperties.value.dir ?? 'ltr',
      lang: localeProperties.value.language ?? locale.value
    }
  }))
}
