<template>
  <div class="bg-base-100 min-h-screen">
    <div class="max-w-[700px] mx-auto px-4 sm:px-6">
      
      <!-- Hero Section -->
      <section class="pt-12 pb-16">
        <span class="text-xs uppercase tracking-[0.15em] text-base-content/80 block mb-3">Our Story</span>
        <h1 class="text-4xl md:text-5xl font-bold tracking-tight text-base-content mb-6">
          {{ $t('about_page.title') }}
        </h1>
      </section>

      <!-- The Problem Section -->
      <section class="py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content/80 mb-8">
          The Problem
        </h2>
        <div class="space-y-6">
          <p class="text-lg text-base-content/80 leading-relaxed font-medium">
            {{ $t('about_page.p1') }}
          </p>
          <p class="text-lg text-base-content/80 leading-relaxed">
            {{ $t('about_page.p2') }}
          </p>
          <p class="text-lg text-base-content/80 leading-relaxed">
            {{ $t('about_page.p3') }}
          </p>
        </div>
      </section>

      <!-- Our Solution Section -->
      <section class="py-16 border-t border-base-content/10">
        <h2 class="text-xs uppercase tracking-[0.2em] font-medium text-base-content/80 mb-8">
          Our Solution
        </h2>
        <div class="space-y-6">
          <p class="text-lg text-base-content/80 leading-relaxed">
            {{ $t('about_page.p4') }}
          </p>
          <div class="border-l-4 border-primary pl-6">
            <p class="text-lg text-base-content/80 leading-relaxed italic">
              {{ $t('about_page.p5') }}
            </p>
          </div>
          <p class="text-lg text-base-content/80 leading-relaxed">
            {{ $t('about_page.p6') }}
          </p>
        </div>
      </section>

      <!-- CTA Section -->
      <section class="py-20 border-t border-base-content/10">
        <div class="card bg-secondary text-secondary-content border border-base-content/10">
          <div class="card-body items-center text-center p-8">
            <p class="text-lg">{{ $t('about_page.p7') }}</p>
            <div class="card-actions mt-4">
              <NuxtLinkLocale to="join" class="btn btn-primary btn-lg">
                {{ $t('about_page.cta_button') }}
              </NuxtLinkLocale>
            </div>
          </div>
        </div>
      </section>

      <!-- Footer Navigation -->
      <footer class="py-12 border-t border-base-content/10 flex flex-wrap gap-4 justify-between items-center">
        <NuxtLinkLocale to="/" class="text-sm text-base-content/80 hover:text-base-content">
          ← Return Home
        </NuxtLinkLocale>
        <div class="flex gap-4">
          <NuxtLinkLocale to="/join" class="btn btn-primary btn-sm">Join Us</NuxtLinkLocale>
        </div>
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
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
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
