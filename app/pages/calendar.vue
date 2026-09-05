<script setup lang="ts">
import CalendarAgendaView from '~/components/calendar/CalendarAgendaView.vue'
import CalendarMonthView from '~/components/calendar/CalendarMonthView.vue'
import {
  eventKindByCategory,
  type CalendarApiResponse,
  type CalendarEvent,
  type CalendarFilter,
  type CalendarViewId
} from '~/content/calendar'

const { locale, localeProperties, t } = useI18n()
const languageTag = computed(() => localeProperties.value.language ?? locale.value)
const activeView = ref<CalendarViewId>('agenda')
const activeFilter = ref<CalendarFilter>('Everything')
const selectedMonthEventId = ref('')
const jumpDate = ref<string | null>(null)
const { data, error, refresh, status } = await useFetch<CalendarApiResponse>('/api/events')

const calendarEvents = computed<readonly CalendarEvent[]>(() =>
  (data.value?.events ?? [])
    .flatMap((event) =>
      event.sessions.map((session, index) => ({
        address: session.locationAddress ?? '',
        dateLabel: formatDate(session.startsAt, session.timezone),
        description: event.description ?? '',
        endsAt: session.endsAt,
        eventPageUrl: event.eventPageUrl,
        id: `${event.id}:${session.id}`,
        kind: eventKindByCategory[event.category],
        place: session.locationName ?? deliveryLabel(session.deliveryMode),
        recurring:
          index === 0 && event.sessions.length > 1 ? t('calendar.upcomingDates', event.sessions.length) : undefined,
        rsvpUrl: session.rsvpUrl ?? event.eventPageUrl,
        startsAt: session.startsAt,
        time: formatTimeRange(session.startsAt, session.endsAt, session.timezone),
        timezone: session.timezone,
        title: event.title
      }))
    )
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt))
)
const visibleEvents = computed(() =>
  jumpDate.value
    ? calendarEvents.value.filter((event) => eventDateKey(event.startsAt, event.timezone) >= jumpDate.value!)
    : calendarEvents.value
)
const jumpMessage = computed(() => {
  if (!jumpDate.value) return ''
  const displayDate = new Intl.DateTimeFormat(languageTag.value, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${jumpDate.value}T12:00:00Z`)
  )
  return t('calendar.showingFrom', { date: displayDate })
})
function jumpToDate(date: string) {
  jumpDate.value = date
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(languageTag.value, {
    day: 'numeric',
    month: 'short',
    timeZone,
    weekday: 'short'
  }).format(new Date(value))
}

function formatTimeRange(startsAt: string, endsAt: string | null, timeZone: string) {
  const formatter = new Intl.DateTimeFormat(languageTag.value, { hour: 'numeric', minute: '2-digit', timeZone })
  return endsAt ? formatter.formatRange(new Date(startsAt), new Date(endsAt)) : formatter.format(new Date(startsAt))
}

function deliveryLabel(deliveryMode: 'hybrid' | 'in_person' | 'virtual') {
  return t(`calendar.delivery.${deliveryMode}`)
}

function eventDateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric'
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

useHead(() => ({
  title: t('metadata.calendar.title'),
  meta: [{ name: 'description', content: t('metadata.calendar.description') }]
}))
</script>

<template>
  <section class="calendar-page" aria-labelledby="calendar-title">
    <header class="calendar-heading">
      <div class="heading-copy">
        <p class="calendar-eyebrow">{{ t('calendar.eyebrow') }}</p>
        <h1 id="calendar-title">{{ t('calendar.title') }}</h1>
        <p>{{ t('calendar.description') }}</p>
      </div>
    </header>

    <div class="calendar-controls">
      <div class="view-tabs" role="group" :aria-label="t('calendar.view.label')">
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'agenda'"
          @click="activeView = 'agenda'"
        >
          {{ t('calendar.view.agenda') }}
        </AppButton>
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'month'"
          @click="activeView = 'month'"
        >
          {{ t('calendar.view.month') }}
        </AppButton>
      </div>
    </div>

    <div v-if="status === 'pending'" class="calendar-state" aria-live="polite">{{ t('calendar.loading') }}</div>
    <div v-else-if="error" class="calendar-state" role="alert">
      <p>{{ t('calendar.loadError') }}</p>
      <AppButton size="compact" variant="secondary" @click="refresh()">{{ t('common.retry') }}</AppButton>
    </div>
    <div v-else-if="visibleEvents.length === 0" class="calendar-state">{{ t('calendar.empty') }}</div>
    <CalendarAgendaView
      v-else-if="activeView === 'agenda'"
      v-model:active-filter="activeFilter"
      :events="visibleEvents"
      :jump-message="jumpMessage"
      @jump="jumpToDate"
    />
    <CalendarMonthView v-else v-model:selected-event-id="selectedMonthEventId" :events="visibleEvents" />
  </section>
</template>

<style scoped>
@layer components {
  .calendar-page {
    display: grid;
    gap: var(--space-7);
    padding-block: clamp(2.5rem, 5vw, 4.5rem);
  }

  .calendar-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .heading-copy h1 {
    max-inline-size: 20ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(2.75rem, 5.5vw, 4.5rem);
    font-weight: 650;
    letter-spacing: -0.035em;
  }

  .heading-copy > p:last-child {
    max-inline-size: 62ch;
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
    font-size: clamp(1rem, 1.5vw, 1.125rem);
    line-height: 1.55;
  }

  .calendar-eyebrow {
    margin: 0 0 var(--space-2);
    color: var(--color-brand-accent);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .calendar-controls {
    border-block-end: 1px solid var(--color-divider);
  }

  .view-tabs {
    display: flex;
    gap: var(--space-5);
  }

  .view-tabs .view-action[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 0;
    border-radius: var(--radius-1) var(--radius-1) 0 0;
    padding: 0.6rem 0.25rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .view-tabs .view-action[data-variant='secondary'][aria-pressed='true'] {
    box-shadow: inset 0 -2px var(--color-action);
  }

  .view-tabs .view-action[data-variant='secondary']:hover {
    background: var(--color-action-soft);
  }

  @media (width <= 44rem) {
    .calendar-page {
      gap: var(--space-6);
      padding-block: var(--space-7);
    }

    .calendar-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .heading-copy h1 {
      font-size: 2.75rem;
    }

    .heading-copy > p:last-child {
      font-size: 1rem;
    }

    .view-tabs .view-action {
      font-size: 1rem;
    }

    .view-tabs {
      gap: var(--space-4);
    }
  }
}
</style>
