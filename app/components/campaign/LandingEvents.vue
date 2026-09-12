<script setup lang="ts">
import EventDirectionsMenu from '~/components/calendar/EventDirectionsMenu.vue'
import { calendarCampaigns, type CalendarApiResponse } from '~/content/calendar'

const { locale, localeProperties, t } = useI18n()
const languageTag = computed(() => localeProperties.value.language ?? locale.value)
const { data, error, refresh, status } = await useFetch<CalendarApiResponse>('/api/events', {
  key: 'deflock-landing-events',
  credentials: 'omit'
})
const campaignTag = calendarCampaigns.find(({ id }) => id === 'deflock-stockton')!.tag
const upcoming = computed(() =>
  (data.value?.events ?? [])
    .flatMap((event) =>
      event.sessions.filter((session) => session.status === 'scheduled').map((session) => ({ event, session }))
    )
    .sort((a, b) => Date.parse(a.session.startsAt) - Date.parse(b.session.startsAt))
)
const campaignEvents = computed(() =>
  upcoming.value.filter(
    ({ event, session }) => campaignTag && (session.campaignTags ?? event.campaignTags)?.includes(campaignTag)
  )
)
const hasCampaignEvents = computed(() => campaignEvents.value.length > 0)
const showingFallback = computed(() => status.value === 'success' && !hasCampaignEvents.value)
const entries = computed(() =>
  (hasCampaignEvents.value ? campaignEvents.value : upcoming.value.slice(0, 1)).map(({ event, session }) => {
    const date = new Date(session.startsAt)
    const timeOptions = { hour: 'numeric', minute: '2-digit', timeZone: session.timezone } as const
    const time = new Intl.DateTimeFormat(languageTag.value, timeOptions)
    const zonedTime = new Intl.DateTimeFormat(languageTag.value, { ...timeOptions, timeZoneName: 'short' })
    return {
      id: session.id,
      title: session.title ?? event.title,
      startsAt: session.startsAt,
      date: new Intl.DateTimeFormat(languageTag.value, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: session.timezone
      }).format(date),
      time: session.endsAt
        ? `${time.format(date)} – ${zonedTime.format(new Date(session.endsAt))}`
        : zonedTime.format(date),
      place: session.locationName ?? session.locationAddress ?? t(`calendar.delivery.${session.deliveryMode}`),
      address: session.locationAddress,
      url: session.rsvpUrl ?? event.eventPageUrl
    }
  })
)
</script>

<template>
  <section id="events" class="landing-events" aria-labelledby="deflock-events-title">
    <div class="flock-field">
      <div class="landing-events-content">
        <header class="landing-events-heading">
          <h2 id="deflock-events-title">
            {{ t(showingFallback ? 'removeFlock.landing.events.none' : 'removeFlock.landing.events.title') }}
          </h2>
          <p v-if="showingFallback && entries.length">{{ t('removeFlock.landing.events.instead') }}</p>
        </header>

        <p v-if="status === 'pending'" role="status">{{ t('calendar.loading') }}</p>
        <div v-else-if="error" class="landing-events-error" role="alert">
          <p>{{ t('calendar.loadError') }}</p>
          <AppButton size="compact" variant="secondary" @click="refresh()">{{ t('common.retry') }}</AppButton>
        </div>
        <ol v-else-if="entries.length" class="landing-events-list" role="list">
          <li v-for="entry in entries" :key="entry.id" class="landing-event">
            <time :datetime="entry.startsAt" class="landing-event-date">
              <strong>{{ entry.date }}</strong>
              <span>{{ entry.time }}</span>
            </time>
            <div class="landing-event-copy">
              <h3>{{ entry.title }}</h3>
              <p>{{ entry.place }}</p>
            </div>
            <div v-if="entry.url || entry.address" class="landing-event-actions">
              <AppActionLink
                v-if="entry.url"
                :to="entry.url"
                variant="secondary"
                size="compact"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ t('calendar.actions.rsvp') }}
              </AppActionLink>
              <EventDirectionsMenu v-if="entry.address" :address="entry.address" />
            </div>
          </li>
        </ol>
        <p v-else>{{ t('calendar.empty') }}</p>

        <AppActionLink to="/calendar" variant="text" class="landing-calendar-link">
          {{ t('removeFlock.landing.events.calendar') }}
        </AppActionLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .landing-events {
    border-block-start: 1px solid var(--color-divider);
    padding-block: clamp(2rem, 4vw, 3.5rem);
    background: var(--color-canvas);
  }

  .landing-events-content {
    container-type: inline-size;
    display: grid;
    justify-items: start;
    gap: var(--space-5);
  }

  .landing-events-heading {
    display: grid;
    gap: var(--space-3);
  }

  .landing-events-heading h2 {
    max-inline-size: 32ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-size: clamp(1.75rem, 3vw, 2.5rem);
    font-weight: 650;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .landing-events p {
    margin: 0;
    font-size: 1rem;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .landing-events-list {
    inline-size: 100%;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .landing-event {
    display: grid;
    gap: var(--space-4);
    min-inline-size: 0;
    border-block-start: 1px solid var(--color-divider);
    padding-block: var(--space-5);
  }

  .landing-event:last-child {
    padding-block-end: 0;
  }

  .landing-event-date {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-muted);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
  }

  .landing-event-date strong {
    color: var(--color-brand-primary);
    font-weight: 650;
  }

  .landing-event-copy {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .landing-event-copy h3 {
    max-inline-size: 40ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.015em;
    text-wrap: balance;
  }

  .landing-event-copy p {
    color: var(--color-text-muted);
  }

  .landing-event-actions {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    min-inline-size: 0;
    font-size: 1rem;
  }

  .landing-calendar-link {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .landing-events-error {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
  }

  @container (min-width: 42rem) {
    .landing-event {
      grid-template-columns: 11rem minmax(0, 1fr) 10.5rem;
      gap: var(--space-7);
      align-items: start;
    }

    .landing-event-copy h3 {
      font-size: 1.375rem;
    }
  }
}
</style>
