<script setup lang="ts">
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('kyr.overview.title'),
})

useSeoMeta({
  description: t('kyr.overview.description'),
  ogType: 'website',
  ogTitle: `${t('kyr.overview.title')} | Working Class Unity`,
  ogDescription: t('kyr.overview.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/know-your-rights',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('kyr.overview.title')} | Working Class Unity`,
  twitterDescription: t('kyr.overview.description'),
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: t('kyr.overview.title'),
    description: t('kyr.overview.description'),
    url: 'https://workingclassunity.com/know-your-rights',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: t('nav.kyr') },
    ],
  }),
])
</script>

<template>
  <div class="min-h-screen bg-base-100 pb-12 md:pb-16">
    <section class="pt-6 pb-7 md:pt-12 md:pb-10">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <article class="wcu-card overflow-hidden border-secondary/30 text-center">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="card-body p-5 sm:p-6 md:p-10">
            <span class="text-xs uppercase tracking-wide text-base-content block mb-3">{{ $t('kyr_nav.section_label') }}</span>
            <h1 class="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4 leading-tight">
              {{ $t('kyr.overview.title') }}
            </h1>
            <p class="text-base sm:text-lg text-base-content/85 max-w-2xl mx-auto">
              {{ $t('kyr.overview.description') }}
            </p>
          </div>
        </article>
      </div>
    </section>

    <section class="pb-8 md:pb-12">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="wcu-card border-secondary/25">
          <div class="card-body p-5 sm:p-6">
            <p class="text-sm sm:text-base text-base-content/85 max-w-3xl">
              Full overview content is being expanded. Use the scenario guides below for direct, step-by-step actions.
            </p>
          </div>
        </div>

        <div class="mt-6">
          <LazyKnowYourRightsNav hydrate-on-idle />
        </div>
      </div>
    </section>
  </div>
</template>
