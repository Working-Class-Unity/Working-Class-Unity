<script setup lang="ts">
import { getUpcomingEvents, type EventType } from '~/data/events'

const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: t('calendar.hero.title'),
})

useSeoMeta({
  description: t('calendar.hero.description'),
  ogType: 'website',
  ogTitle: `${t('calendar.hero.title')} | Working Class Unity`,
  ogDescription: t('calendar.hero.description'),
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/calendar',
  twitterCard: 'summary_large_image',
  twitterTitle: `${t('calendar.hero.title')} | Working Class Unity`,
  twitterDescription: t('calendar.hero.description'),
})

useSchemaOrg([
  defineWebPage({
    '@type': 'CollectionPage',
    name: t('calendar.hero.title'),
    description: t('calendar.hero.description'),
    url: 'https://workingclassunity.com/calendar',
  }),
])

// =============================================================================
// Filter State
// =============================================================================
const selectedType = ref<EventType | 'all'>('all')

// Event type options for filter
const eventTypes: { value: EventType | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'calendar.filters.all' },
  { value: 'meeting', labelKey: 'calendar.filters.meeting' },
  { value: 'action', labelKey: 'calendar.filters.action' },
  { value: 'training', labelKey: 'calendar.filters.training' },
  { value: 'social', labelKey: 'calendar.filters.social' },
  { value: 'canvass', labelKey: 'calendar.filters.canvass' },
  { value: 'forum', labelKey: 'calendar.filters.forum' },
  { value: 'other', labelKey: 'calendar.filters.other' }
]

// Computed filtered events
const filteredEvents = computed(() => {
  const upcoming = getUpcomingEvents()
  if (selectedType.value === 'all') {
    return upcoming
  }
  return upcoming.filter((event) => event.eventType === selectedType.value)
})

// Screen reader announcement for filter updates
const selectedTypeLabel = computed(() => {
  const match = eventTypes.find((t) => t.value === selectedType.value)
  return match ? t(match.labelKey) : t('calendar.filters.all')
})

const filterAnnouncement = computed(() => {
  return t('calendar.a11y.filter_results', {
    filter: selectedTypeLabel.value,
    count: filteredEvents.value.length,
  })
})
</script>

<template>
  <div class="pb-12 md:pb-16">
    <!-- Hero Section -->
    <section class="pt-8 pb-8 md:pt-12 md:pb-10">
      <div class="wcu-container">
        <article class="wcu-card overflow-hidden border-secondary/30 text-center">
          <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
          <div class="card-body p-6 md:p-10">
            <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-base-content mb-4">
              {{ $t('calendar.hero.title') }}
            </h1>
            <p class="text-lg text-base-content/90 max-w-2xl mx-auto">
              {{ $t('calendar.hero.description') }}
            </p>
          </div>
        </article>
      </div>
    </section>

    <!-- Filter Section -->
    <section class="pb-8">
      <div class="wcu-container">
        <div class="wcu-card border-secondary/25">
          <div class="card-body p-4 md:p-5">
            <div class="flex flex-wrap gap-2 justify-center" role="group" :aria-label="$t('calendar.filter_aria_label')">
              <button
                v-for="type in eventTypes"
                :key="type.value"
                @click="selectedType = type.value"
                type="button"
                :aria-pressed="selectedType === type.value"
                class="btn btn-sm"
                :class="selectedType === type.value ? 'btn-primary' : 'btn-ghost bg-base-200 border border-secondary/20'"
              >
                {{ $t(type.labelKey) }}
              </button>
            </div>

            <p class="sr-only" aria-live="polite">{{ filterAnnouncement }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Events Grid Section -->
    <section class="py-8 md:py-12">
      <div class="wcu-container">
        <!-- Section label -->
        <p class="text-xs uppercase tracking-wide text-base-content mb-6">
          {{ $t('calendar.upcoming_events') }} ({{ filteredEvents.length }})
        </p>

        <!-- Empty state -->
        <div
          v-if="filteredEvents.length === 0"
          class="text-center py-16"
        >
          <div class="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center mx-auto mb-4">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-base-content/40">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          </div>
          <p class="text-base-content/80">{{ $t('calendar.no_events') }}</p>
        </div>

        <!-- Events Grid -->
        <ul
          v-else
          role="list"
          :aria-label="$t('calendar.events_list_aria_label')"
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 list-none"
        >
          <li v-for="event in filteredEvents" :key="event.id">
            <EventCard :event="event" />
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
