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
  <div class="min-h-screen bg-base-100">
    <!-- Hero Section -->
    <section class="py-16 md:py-24 bg-base-200" aria-labelledby="hero-heading">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="max-w-4xl mx-auto text-center">
          <h1 id="hero-heading" class="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-base-content mb-6">
            {{ $t('home_page.hero.title') }}
          </h1>
          <p class="text-lg md:text-xl text-base-content/80 mb-8 max-w-3xl mx-auto">
            {{ $t('home_page.hero.description') }}
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <NuxtLinkLocale to="/join" class="btn btn-primary btn-lg">
              {{ $t('home_page.hero.join_button') }}
            </NuxtLinkLocale>
            <NuxtLinkLocale to="/calendar" class="btn btn-outline btn-lg">
              {{ $t('home_page.hero.events_button') }}
            </NuxtLinkLocale>
          </div>
        </div>
      </div>
    </section>

    <!-- Upcoming Events Section -->
    <section class="py-12 md:py-16" aria-labelledby="events-heading">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p class="text-xs uppercase tracking-wide text-base-content/80 mb-6">
          {{ $t('calendar.upcoming_events') }}
        </p>
        <h2 id="events-heading" class="sr-only">{{ $t('home_page.events.heading') }}</h2>

        <!-- Events Grid -->
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

        <!-- View all events link -->
        <div class="text-center mt-8">
          <NuxtLinkLocale to="/calendar" class="btn btn-ghost btn-sm gap-2">
            {{ $t('home_page.events.view_all') }}
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </NuxtLinkLocale>
        </div>
      </div>
    </section>

    <!-- The Problem Section -->
    <section class="py-12 md:py-16 bg-base-200" aria-labelledby="problem-heading">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="max-w-3xl mx-auto">
          <p class="text-xs uppercase tracking-wide text-base-content/80 mb-4">
            {{ $t('home_page.problem.label') }}
          </p>
          <h2 id="problem-heading" class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-6">
            {{ $t('home_page.problem.title') }}
          </h2>
          <div class="prose prose-lg text-base-content/80">
            <p>
              {{ $t('home_page.problem.p1') }}
            </p>
            <p>
              {{ $t('home_page.problem.p2') }}
            </p>
            <p>
              {{ $t('home_page.problem.p3') }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
