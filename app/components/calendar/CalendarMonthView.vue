<script setup lang="ts">
import CalendarEventActions from '~/components/calendar/CalendarEventActions.vue'
import CalendarEventBadge from '~/components/calendar/CalendarEventBadge.vue'
import type { CalendarEvent, CalendarMonthCell } from '~/content/calendar'

const props = defineProps<{
  events: readonly CalendarEvent[]
}>()

const selectedEventId = defineModel<string>('selectedEventId', { required: true })
const { locale, localeProperties, t } = useI18n()
const languageTag = computed(() => localeProperties.value.language ?? locale.value)
const selectedEvent = computed(() => eventById(selectedEventId.value))
const visibleMonth = ref(monthKey(props.events[0] ?? null))
const monthLabel = computed(() => {
  const [year, month] = visibleMonth.value.split('-').map(Number)
  return new Intl.DateTimeFormat(languageTag.value, { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(
    new Date(Date.UTC(year!, month! - 1, 1))
  )
})
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(languageTag.value, { timeZone: 'UTC', weekday: 'short' }).format(
      new Date(Date.UTC(2024, 0, 7 + index))
    )
  )
)
const cells = computed<readonly CalendarMonthCell[]>(() => {
  const [year, month] = visibleMonth.value.split('-').map(Number)
  const first = new Date(Date.UTC(year!, month! - 1, 1))
  const gridStart = new Date(first)
  gridStart.setUTCDate(1 - first.getUTCDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const dateKey = date.toISOString().slice(0, 10)
    return {
      date: dateKey,
      day: String(date.getUTCDate()),
      eventIds: props.events.filter((event) => eventDateKey(event) === dateKey).map(({ id }) => id),
      outsideMonth: date.getUTCMonth() !== month! - 1
    }
  })
})

watch(
  () => props.events,
  (events) => {
    if (events[0] && !events.some(({ id }) => id === selectedEventId.value)) {
      visibleMonth.value = monthKey(events[0])
      selectedEventId.value = events[0].id
    }
  },
  { immediate: true }
)

function eventById(eventId: string) {
  return props.events.find((event) => event.id === eventId)
}

function changeMonth(offset: number) {
  const [year, month] = visibleMonth.value.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1 + offset, 1))
  visibleMonth.value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
  selectedEventId.value = props.events.find((event) => eventDateKey(event).startsWith(visibleMonth.value))?.id ?? ''
}

function monthKey(event: CalendarEvent | null) {
  return event ? eventDateKey(event).slice(0, 7) : new Date().toISOString().slice(0, 7)
}

function eventDateKey(event: CalendarEvent) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: event.timezone,
    year: 'numeric'
  }).formatToParts(new Date(event.startsAt))
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${value.year}-${value.month}-${value.day}`
}
</script>

<template>
  <section class="month-view" aria-labelledby="month-title">
    <div class="view-heading">
      <div>
        <h2 id="month-title">{{ t('calendar.month.title') }}</h2>
        <p>{{ t('calendar.month.description') }}</p>
      </div>
    </div>
    <div class="month-toolbar">
      <AppButton class="month-action" size="compact" variant="secondary" @click="changeMonth(-1)">
        {{ t('calendar.month.previous') }}
      </AppButton>
      <h3>{{ monthLabel }}</h3>
      <AppButton class="month-action" size="compact" variant="secondary" @click="changeMonth(1)">
        {{ t('calendar.month.next') }}
      </AppButton>
    </div>
    <div class="month-layout">
      <div class="month-grid-wrap">
        <div class="month-grid" :aria-label="t('calendar.month.eventsLabel', { month: monthLabel })">
          <div v-for="day in weekdays" :key="day" class="weekday">
            {{ day }}
          </div>
          <div
            v-for="(cell, index) in cells"
            :key="index"
            class="month-cell"
            :class="{ 'outside-month': cell.outsideMonth }"
          >
            <span class="day-number">{{ cell.day }}</span>
            <AppButton
              v-for="eventId in cell.eventIds"
              :key="eventId"
              class="calendar-event"
              size="compact"
              variant="secondary"
              :class="`event-${eventById(eventId)?.kind.toLowerCase()}`"
              :aria-pressed="selectedEventId === eventId"
              :aria-label="`${eventById(eventId)?.title}, ${cell.date}`"
              @click="selectedEventId = eventId"
            >
              {{ eventById(eventId)?.title }}
            </AppButton>
          </div>
        </div>
      </div>

      <aside v-if="selectedEvent" class="event-inspector" aria-labelledby="selected-event-title">
        <h3 id="selected-event-title">{{ selectedEvent.title }}</h3>
        <CalendarEventBadge :kind="selectedEvent.kind" />
        <p class="selected-time">{{ selectedEvent.dateLabel }} · {{ selectedEvent.time }}</p>
        <p>{{ selectedEvent.place }} · {{ selectedEvent.address }}</p>
        <p>{{ selectedEvent.description }}</p>
        <p v-if="selectedEvent.recurring" class="recurrence-note">{{ selectedEvent.recurring }}</p>
        <CalendarEventActions class="inspector-actions" :event="selectedEvent" show-directions />
      </aside>
      <aside v-else class="event-inspector" aria-live="polite">
        <h3>{{ t('calendar.month.noEvents') }}</h3>
        <p>{{ t('calendar.month.browse') }}</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .month-view {
    display: grid;
    gap: var(--space-6);
  }

  .view-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .view-heading h2,
  .event-inspector h3 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-weight: 650;
    letter-spacing: -0.035em;
  }

  .view-heading h2 {
    margin: 0;
    font-size: clamp(2rem, 4vw, 2.75rem);
  }

  .view-heading p {
    max-inline-size: 60ch;
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    line-height: 1.5;
  }

  .month-toolbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-4);
    border-block-end: 1px solid var(--color-divider);
    padding-block-end: var(--space-4);
  }

  .month-toolbar h3 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
  }

  .month-toolbar .month-action[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 0;
    padding: 0.6rem 0.25rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .month-toolbar .month-action:first-child {
    justify-self: start;
  }

  .month-toolbar .month-action:last-child {
    justify-self: end;
  }

  .month-toolbar .month-action[data-variant='secondary']:hover {
    background: var(--color-action-soft);
  }

  .month-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 19rem;
    gap: var(--space-6);
    align-items: start;
  }

  .month-grid-wrap {
    max-inline-size: 100%;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .month-grid {
    display: grid;
    min-inline-size: 52rem;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    border-block-start: 1px solid var(--color-divider);
    border-inline-start: 1px solid var(--color-divider);
  }

  .weekday {
    min-block-size: 2.5rem;
    border-block-end: 1px solid var(--color-divider);
    border-inline-end: 1px solid var(--color-divider);
    padding: 0.6rem;
    color: var(--color-text-muted);
    font-size: 0.8125rem;
    font-weight: 650;
  }

  .month-cell {
    min-block-size: 7.2rem;
    border-block-end: 1px solid var(--color-divider);
    border-inline-end: 1px solid var(--color-divider);
    padding: var(--space-2);
  }

  .outside-month {
    color: var(--color-text-muted);
    background: var(--color-surface-subtle);
    opacity: 0.55;
  }

  .day-number {
    display: block;
    margin-block-end: var(--space-1);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  .calendar-event[data-variant='secondary'] {
    inline-size: 100%;
    min-block-size: var(--control-min-block-size);
    border: 0;
    border-radius: var(--radius-1);
    padding: 0.45rem 0.5rem;
    color: var(--color-brand-primary);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 650;
    text-align: start;
    filter: none;
    cursor: pointer;
  }

  .calendar-event + .calendar-event {
    margin-block-start: var(--space-1);
  }

  .calendar-event[data-variant='secondary'].event-meeting {
    background: var(--color-event-organizing-surface);
  }

  .calendar-event[data-variant='secondary'].event-action {
    background: var(--color-event-action-surface);
  }

  .calendar-event[data-variant='secondary'].event-social {
    background: var(--color-event-community-surface);
  }

  .calendar-event[data-variant='secondary'].event-learning {
    background: var(--color-event-training-surface);
  }

  .calendar-event[data-variant='secondary']:hover {
    box-shadow: inset 0 0 0 1px var(--color-action);
  }

  .calendar-event[data-variant='secondary'][aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px var(--color-action);
  }

  .event-inspector {
    position: sticky;
    inset-block-start: var(--space-4);
    border-radius: var(--radius-3);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
  }

  .event-inspector h3 {
    max-inline-size: 24ch;
    margin: 0 0 var(--space-3);
    font-size: 1.75rem;
  }

  .event-inspector > p {
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
    line-height: 1.5;
  }

  .event-inspector .selected-time {
    color: var(--color-brand-primary);
    font-weight: 650;
  }

  .recurrence-note {
    border-block-start: 1px solid var(--color-divider);
    padding-block-start: var(--space-3);
  }

  .inspector-actions {
    inline-size: 9.5rem;
    margin-block-start: var(--space-5);
  }

  @media (width <= 60rem) {
    .month-layout {
      grid-template-columns: 1fr;
    }

    .event-inspector {
      position: static;
      order: -1;
    }

    .inspector-actions {
      inline-size: min(100%, 18rem);
    }
  }

  @media (width <= 44rem) {
    .view-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .view-heading p,
    .event-inspector > p {
      font-size: 1rem;
    }

    .inspector-actions {
      inline-size: 100%;
    }

    .calendar-event {
      font-size: 0.875rem;
    }

    .event-inspector {
      padding: var(--space-4);
    }
  }
}
</style>
