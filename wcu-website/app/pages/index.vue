<script setup lang="ts">
import { getUpcomingEvents } from '~/data/events'

const { t, locale } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
// Page title (gets appended with " | Working Class Unity" via titleTemplate in app.vue)
useHead({
  title: t('home_page.hero.title'),
})

// SEO meta tags for search engines, Open Graph (Facebook/LinkedIn), and Twitter
useSeoMeta({
  description: t('home_page.hero.description'),
  
  // Open Graph tags (Facebook, LinkedIn, etc.)
  ogType: 'website',
  ogTitle: `${t('home_page.hero.title')} | Working Class Unity`,
  ogDescription: t('home_page.hero.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com',
  ogSiteName: 'Working Class Unity',
  ogLocale: locale.value,
  
  // Twitter Card tags
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('home_page.hero.title')} | Working Class Unity`,
  twitterDescription: t('home_page.hero.description'),
  twitterImage: 'https://workingclassunity.com/logo_dark.svg',
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
// WebPage schema for the home page - automatically links to the Organization defined in app.vue
// The "about" relation is automatically added for the home page (/) pointing to the Organization
useSchemaOrg([
  defineWebPage({
    name: t('home_page.hero.title'),
    description: t('home_page.hero.description'),
    url: 'https://workingclassunity.com',
  }),
])

// =============================================================================
// Page Data
// =============================================================================
// Get 3 upcoming events
const upcomingEvents = computed(() => getUpcomingEvents(3))
</script>

<template>
  <div class="pb-12 md:pb-16">
    <section class="pt-8 pb-10 md:pt-12 md:pb-14" aria-labelledby="hero-heading">
      <div class="wcu-container">
        <div class="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
          <article class="wcu-card overflow-hidden border-secondary/30">
            <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
            <div class="card-body p-6 md:p-10">
              <p class="wcu-eyebrow mb-4">{{ $t('home_page.problem.label') }}</p>
              <h1 id="hero-heading" class="text-4xl md:text-5xl xl:text-6xl font-bold tracking-tight text-base-content">
                {{ $t('home_page.hero.title') }}
              </h1>
              <p class="text-lg md:text-xl wcu-muted mt-6 max-w-4xl">
                {{ $t('home_page.hero.description') }}
              </p>
              <div class="flex flex-col sm:flex-row gap-3 mt-8">
                <NuxtLinkLocale to="/join" class="btn btn-lg bg-accent border-accent text-base-100 hover:bg-accent/90 hover:border-accent/90">
                  {{ $t('home_page.hero.join_button') }}
                </NuxtLinkLocale>
                <NuxtLinkLocale to="/calendar" class="btn btn-secondary btn-lg">
                  {{ $t('home_page.hero.events_button') }}
                </NuxtLinkLocale>
              </div>
            </div>
          </article>

          <aside class="wcu-card bg-secondary text-secondary-content border-secondary/45">
            <div class="card-body p-6 md:p-7">
              <h2 class="text-2xl font-bold tracking-tight text-secondary-content">
                {{ $t('home_page.events.heading') }}
              </h2>
              <p class="text-secondary-content/90 mt-2">
                {{ $t('calendar.upcoming_events') }}: {{ upcomingEvents.length }}
              </p>
              <div class="mt-6 space-y-3">
                <NuxtLinkLocale to="/kyr" class="btn btn-primary justify-start w-full">
                  {{ $t('nav.kyr') }}
                </NuxtLinkLocale>
                <NuxtLinkLocale to="/campaigns" class="btn btn-outline border-primary/70 text-secondary-content hover:text-secondary w-full justify-start">
                  {{ $t('nav.campaigns') }}
                </NuxtLinkLocale>
                <a
                  href="https://chat.workingclassunity.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-outline border-primary/70 text-secondary-content hover:text-secondary w-full justify-start"
                >
                  {{ $t('nav.forum') }}
                  <span class="sr-only">{{ $t('common.opens_in_new_tab') }}</span>
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <section class="py-10 md:py-12" aria-labelledby="events-heading">
      <div class="wcu-container">
        <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h2 id="events-heading" class="text-2xl md:text-3xl font-bold text-base-content">
            {{ $t('home_page.events.heading') }}
          </h2>
          <NuxtLinkLocale to="/calendar" class="btn btn-ghost btn-sm border border-secondary/25 hover:bg-primary/10">
            {{ $t('home_page.events.view_all') }}
          </NuxtLinkLocale>
        </div>

        <div
          v-if="upcomingEvents.length > 0"
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <EventCard
            v-for="event in upcomingEvents"
            :key="event.id"
            :event="event"
          />
        </div>

        <div v-else class="wcu-card border-secondary/25">
          <div class="card-body p-6">
            <p class="font-semibold text-base-content">{{ $t('calendar.no_events') }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="py-10 md:py-12" aria-labelledby="problem-heading">
      <div class="wcu-prose-container">
        <article class="wcu-card overflow-hidden border-secondary/30">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="card-body p-6 md:p-8">
            <p class="wcu-eyebrow mb-3">
              {{ $t('home_page.problem.label') }}
            </p>
            <h2 id="problem-heading" class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-5">
              {{ $t('home_page.problem.title') }}
            </h2>
            <div class="prose prose-lg max-w-none text-base-content">
              <p class="wcu-muted">
                {{ $t('home_page.problem.p1') }}
              </p>
              <p class="wcu-muted">
                {{ $t('home_page.problem.p2') }}
              </p>
              <p class="wcu-muted">
                {{ $t('home_page.problem.p3') }}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
