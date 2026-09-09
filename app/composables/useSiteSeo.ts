import {
  absoluteSiteUrl,
  findPublicPage,
  localizedPublicPath,
  pageStructuredData,
  publicLocales,
  resolvePageMetadata,
  serializeStructuredData,
  siteSocialImage
} from '#shared/public-site'

export function useSiteSeo() {
  const route = useRoute()
  const config = useRuntimeConfig()
  const { locale, t } = useI18n()
  const campaign = useRemoveFlockContent()
  const page = computed(() => findPublicPage(route.path))
  const metadata = computed(() =>
    page.value ? resolvePageMetadata(page.value, t, (key) => campaign[key].value) : undefined
  )
  const url = computed(() =>
    page.value ? absoluteSiteUrl(config.public.appUrl, localizedPublicPath(page.value.path, locale.value)) : undefined
  )
  const image = computed(() => (page.value ? absoluteSiteUrl(config.public.appUrl, siteSocialImage.path) : undefined))

  useSeoMeta({
    title: () => metadata.value?.title,
    description: () => metadata.value?.description,
    robots: () => (page.value ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'),
    ogTitle: () => metadata.value?.title,
    ogDescription: () => metadata.value?.description,
    ogUrl: () => url.value,
    ogType: () => (page.value ? (page.value.schemaType === 'Article' ? 'article' : 'website') : undefined),
    ogSiteName: () => (page.value ? 'Working Class Unity' : undefined),
    ogLocale: () => (page.value ? publicLocales.find((entry) => entry.code === locale.value)?.ogLocale : undefined),
    ogImage: () => image.value,
    ogImageType: () => (page.value ? 'image/png' : undefined),
    ogImageWidth: () => (page.value ? siteSocialImage.width : undefined),
    ogImageHeight: () => (page.value ? siteSocialImage.height : undefined),
    ogImageAlt: () => (page.value ? siteSocialImage.alt : undefined),
    twitterCard: () => (page.value ? 'summary_large_image' : undefined),
    twitterTitle: () => metadata.value?.title,
    twitterDescription: () => metadata.value?.description,
    twitterImage: () => image.value,
    twitterImageAlt: () => (page.value ? siteSocialImage.alt : undefined)
  })

  useHead(() => ({
    link:
      page.value && url.value
        ? [
            { rel: 'canonical', href: url.value },
            ...publicLocales.map(({ code }) => ({
              rel: 'alternate' as const,
              hreflang: code,
              href: absoluteSiteUrl(config.public.appUrl, localizedPublicPath(page.value!.path, code))
            })),
            { rel: 'alternate', hreflang: 'x-default', href: absoluteSiteUrl(config.public.appUrl, page.value.path) }
          ]
        : [],
    script:
      page.value && metadata.value
        ? [
            {
              key: 'public-page-schema',
              type: 'application/ld+json',
              innerHTML: serializeStructuredData(
                pageStructuredData(page.value, metadata.value, config.public.appUrl, locale.value)
              )
            }
          ]
        : []
  }))
}
