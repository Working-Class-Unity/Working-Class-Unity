<template>
  <div class="pb-12 md:pb-16">
    <div class="wcu-prose-container pt-6 md:pt-12">
      <article class="wcu-card overflow-hidden border-secondary/30">
        <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
        <div class="card-body p-5 md:p-10">
          <header class="pb-6 md:pb-8">
            <span class="wcu-eyebrow block mb-3">{{ $t('about_page.eyebrow') }}</span>
            <h1 class="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-base-content">
              {{ $t('about_page.title') }}
            </h1>
          </header>

          <section class="py-6 md:py-8 border-t border-base-content/10" aria-labelledby="about-problem-heading">
            <h2 id="about-problem-heading" class="text-xs uppercase tracking-[0.2em] font-semibold text-base-content mb-6">
              {{ $t('about_page.problem_heading') }}
            </h2>
            <div class="space-y-6">
              <p class="text-base md:text-lg text-base-content leading-relaxed font-medium">
                {{ $t('about_page.p1') }}
              </p>
              <p class="text-base md:text-lg text-base-content/90 leading-relaxed">
                {{ $t('about_page.p2') }}
              </p>
              <p class="text-base md:text-lg text-base-content/90 leading-relaxed">
                {{ $t('about_page.p3') }}
              </p>
            </div>
          </section>

          <section class="py-6 md:py-8 border-t border-base-content/10" aria-labelledby="about-solution-heading">
            <h2 id="about-solution-heading" class="text-xs uppercase tracking-[0.2em] font-semibold text-base-content mb-6">
              {{ $t('about_page.solution_heading') }}
            </h2>
            <div class="space-y-6">
              <p class="text-base md:text-lg text-base-content/90 leading-relaxed">
                {{ $t('about_page.p4') }}
              </p>
              <div class="border-l-4 border-primary pl-4 sm:pl-6">
                <p class="text-base md:text-lg text-base-content leading-relaxed italic">
                  {{ $t('about_page.p5') }}
                </p>
              </div>
              <p class="text-base md:text-lg text-base-content/90 leading-relaxed">
                {{ $t('about_page.p6') }}
              </p>
            </div>
          </section>

          <section class="pt-8 md:pt-10 border-t border-base-content/10">
            <div class="wcu-card bg-secondary text-secondary-content border-secondary/45">
              <div class="card-body items-center text-center p-5 sm:p-6 md:p-8">
                <p class="text-base sm:text-lg">{{ $t('about_page.p7') }}</p>
                <div class="card-actions mt-4">
                  <NuxtLinkLocale to="join" class="btn btn-primary min-h-11 h-11 px-5 text-base">
                    {{ $t('about_page.cta_button') }}
                  </NuxtLinkLocale>
                </div>
              </div>
            </div>
          </section>
        </div>
      </article>

      <footer class="pt-6 md:pt-8 flex flex-wrap gap-4 items-center">
        <NuxtLinkLocale to="/" class="inline-flex items-center min-h-10 px-3 rounded-md border border-base-300 text-sm text-base-content/80 hover:text-base-content hover:bg-base-200/60 transition-colors">
          ← {{ $t('common.return_home') }}
        </NuxtLinkLocale>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('about_page.title'),
})

useSeoMeta({
  description: t('about_page.p1'),
  ogType: 'website',
  ogTitle: `${t('about_page.title')} | Working Class Unity`,
  ogDescription: t('about_page.p1'),
  ogImage: 'https://workingclassunity.com/og/wcu-default.svg',
  ogUrl: 'https://workingclassunity.com/about',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('about_page.title')} | Working Class Unity`,
  twitterDescription: t('about_page.p1'),
})

useSchemaOrg([
  defineWebPage({
    '@type': 'AboutPage',
    name: t('about_page.title'),
    description: t('about_page.p1'),
    url: 'https://workingclassunity.com/about',
  }),
])
</script>
