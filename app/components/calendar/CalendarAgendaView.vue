<script setup lang="ts">
import CalendarDatePicker from '~/components/calendar/CalendarDatePicker.vue'
import CalendarEventActions from '~/components/calendar/CalendarEventActions.vue'
import CalendarEventBadge from '~/components/calendar/CalendarEventBadge.vue'
import { calendarFilters, type CalendarEvent, type CalendarFilter } from '~/content/calendar'

const props = defineProps<{
  events: readonly CalendarEvent[]
  jumpMessage: string
}>()

const activeFilter = defineModel<CalendarFilter>('activeFilter', { required: true })
const emit = defineEmits<{
  jump: [date: string]
  rsvp: [eventName: string]
}>()

const featuredEvent = computed(() => props.events[0]!)
const recurringEvents = computed(() => props.events.filter((event) => event.recurring))
const agendaEvents = computed(() => {
  const upcoming = props.events.filter((event) => event.id !== 'general-meeting' && event.id !== 'coffee')
  if (activeFilter.value === 'Everything') return upcoming
  return upcoming.filter((event) => event.kind === activeFilter.value)
})

function eventStartTime(time: string) {
  const [start = time, end = ''] = time.split('–')
  const suffix = end.match(/\b(?:AM|PM)\b/)?.[0]
  return /\b(?:AM|PM)\b/.test(start) || !suffix ? start : `${start} ${suffix}`
}

function recurrenceSchedule(event: CalendarEvent) {
  return event.recurring?.split(' · ')[0] ?? ''
}
</script>

<template>
  <section class="agenda-view" aria-labelledby="agenda-title">
    <div class="view-heading">
      <div>
        <h2 id="agenda-title">Upcoming events</h2>
        <p>Recurring programs appear once, so the next useful opportunity stays easy to find.</p>
      </div>
      <CalendarDatePicker @select="emit('jump', $event)" />
    </div>
    <p v-if="jumpMessage" class="jump-message" aria-live="polite">{{ jumpMessage }}</p>

    <article class="featured-event">
      <time :datetime="featuredEvent.startsAt" class="featured-date">
        <span>Aug</span>
        <strong>20</strong>
        <span>Thursday</span>
      </time>
      <div class="featured-copy">
        <div class="event-labels">
          <CalendarEventBadge :kind="featuredEvent.kind" />
        </div>
        <h3>{{ featuredEvent.title }}</h3>
        <p>{{ featuredEvent.description }}</p>
        <dl class="event-details">
          <div>
            <dt>Time</dt>
            <dd>{{ featuredEvent.time }}</dd>
          </div>
          <div>
            <dt>Meet at</dt>
            <dd>{{ featuredEvent.place }}, Stockton</dd>
          </div>
        </dl>
      </div>
      <CalendarEventActions
        class="featured-actions"
        :event="featuredEvent"
        show-directions
        @rsvp="emit('rsvp', $event.title)"
      />
    </article>

    <div class="agenda-filter-row">
      <p>Filter upcoming events</p>
      <div class="event-filters" role="group" aria-label="Filter upcoming events">
        <AppButton
          v-for="filter in calendarFilters"
          :key="filter"
          class="filter-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeFilter === filter"
          @click="activeFilter = filter"
        >
          {{ filter === 'Everything' ? 'All' : filter === 'Action' ? 'Actions' : filter }}
        </AppButton>
      </div>
    </div>

    <div class="agenda-layout">
      <section aria-labelledby="up-next-title">
        <div class="section-heading-row">
          <div>
            <p class="section-label">Up next</p>
            <h3 id="up-next-title">August</h3>
          </div>
        </div>
        <ol class="event-list" role="list">
          <li v-for="event in agendaEvents" :key="event.id" class="event-row">
            <time :datetime="event.startsAt"
              ><strong>{{ event.dateLabel.replace(',', '') }}</strong
              ><span>{{ eventStartTime(event.time) }}</span></time
            >
            <div class="event-row-copy">
              <div class="event-labels">
                <CalendarEventBadge :kind="event.kind" />
                <span v-if="event.recurring" class="series-badge">Series</span>
              </div>
              <h4>{{ event.title }}</h4>
              <p>{{ event.description }}</p>
              <AppButton v-if="event.recurring" class="text-action" size="compact" variant="secondary">
                {{ event.recurring }}
              </AppButton>
            </div>
            <CalendarEventActions
              class="row-actions"
              :event="event"
              rsvp-variant="secondary"
              @rsvp="emit('rsvp', $event.title)"
            />
          </li>
          <li v-if="agendaEvents.length === 0" class="empty-state">No events match this filter yet.</li>
        </ol>
      </section>

      <aside class="series-panel" aria-labelledby="series-title">
        <p class="section-label">Recurring events</p>
        <h3 id="series-title">More dates</h3>
        <div v-for="event in recurringEvents" :key="event.id" class="series-item">
          <CalendarEventBadge :kind="event.kind" />
          <h4>{{ event.title }}</h4>
          <p>{{ recurrenceSchedule(event) }} · {{ eventStartTime(event.time) }}</p>
          <AppButton class="text-action" size="compact" variant="secondary">See 4 upcoming dates</AppButton>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .agenda-view {
    display: grid;
    gap: var(--space-6);
  }

  .view-heading,
  .section-heading-row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .view-heading h2,
  .featured-copy h3 {
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

  .jump-message {
    margin: calc(var(--space-4) * -1) 0 0;
    color: var(--color-text-muted);
  }

  .featured-event {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr) 10.5rem;
    gap: clamp(1.25rem, 3vw, 2.25rem);
    align-items: center;
    border-block: 1px solid var(--color-divider);
    padding-block: clamp(1.5rem, 3vw, 2.25rem);
  }

  .featured-date {
    display: grid;
    border-inline-end: 1px solid var(--color-divider);
    color: var(--color-brand-primary);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .featured-date strong {
    font-family: var(--font-family-display);
    font-size: 3.5rem;
    line-height: 1;
  }

  .event-labels {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .series-badge {
    display: inline-flex;
    min-block-size: 1.625rem;
    align-items: center;
    border-radius: var(--radius-round);
    padding: 0.2rem 0.6rem;
    color: var(--color-neutral-tag-text);
    background: var(--color-neutral-tag-surface);
    font-size: 0.75rem;
    font-weight: 650;
  }

  .featured-copy {
    min-inline-size: 0;
  }

  .featured-copy h3 {
    max-inline-size: 28ch;
    margin: var(--space-2) 0;
    font-size: clamp(1.75rem, 3vw, 2.25rem);
  }

  .featured-copy > p {
    max-inline-size: 60ch;
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.55;
  }

  .event-details {
    display: flex;
    gap: var(--space-6);
    margin: var(--space-4) 0 0;
  }

  .event-details div {
    display: grid;
    gap: var(--space-1);
  }

  .event-details dt {
    color: var(--color-brand-primary);
    font-size: 0.8125rem;
    font-weight: 650;
  }

  .event-details dd {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .featured-actions {
    inline-size: 10.5rem;
  }

  .row-actions {
    inline-size: 9.5rem;
  }

  .agenda-filter-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .agenda-filter-row > p {
    margin: 0;
    color: var(--color-brand-primary);
    font-size: 0.875rem;
    font-weight: 650;
  }

  .event-filters {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .event-filters .filter-action[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 0;
    border-radius: var(--radius-2);
    padding: 0.6rem 0.75rem;
    color: var(--color-text-muted);
    background: transparent;
    font: inherit;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .event-filters .filter-action[data-variant='secondary']:hover,
  .event-filters .filter-action[data-variant='secondary'][aria-pressed='true'] {
    color: var(--color-action);
    background: var(--color-action-soft);
  }

  .event-filters .filter-action[data-variant='secondary'][aria-pressed='true'] {
    box-shadow: inset 0 0 0 1px var(--color-action);
  }

  .agenda-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: var(--space-7);
    align-items: start;
  }

  .section-label {
    margin: 0 0 var(--space-2);
    color: var(--color-brand-accent);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .section-heading-row h3,
  .series-panel h3 {
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
  }

  .event-list {
    margin: var(--space-4) 0 0;
    padding: 0;
  }

  .event-row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr) 9.5rem;
    gap: var(--space-4);
    align-items: start;
    border-block-start: 1px solid var(--color-divider);
    padding-block: var(--space-5);
  }

  .event-row time {
    display: grid;
    gap: var(--space-1);
    color: var(--color-brand-primary);
    font-variant-numeric: tabular-nums;
  }

  .event-row time span {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .event-row-copy {
    min-inline-size: 0;
  }

  .event-row-copy h4,
  .series-item h4 {
    margin: var(--space-2) 0 var(--space-1);
    color: var(--color-text);
    font-size: 1rem;
    font-weight: 650;
  }

  .event-row-copy p,
  .series-item p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .text-action[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 0;
    padding: 0.6rem 0;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    text-align: start;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    filter: none;
    cursor: pointer;
  }

  .text-action[data-variant='secondary']:hover {
    color: var(--color-accent-action-hover);
  }

  .series-panel {
    display: grid;
    gap: var(--space-4);
    border-radius: var(--radius-3);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
  }

  .series-panel .section-label {
    margin-block-end: calc(var(--space-3) * -1);
  }

  .series-item {
    display: grid;
    gap: var(--space-1);
    border-block-start: 1px solid var(--color-divider);
    padding-block-start: var(--space-4);
  }

  .series-item h4 {
    margin-block: var(--space-1) 0;
  }

  .empty-state {
    border-block-start: 1px solid var(--color-divider);
    padding-block: var(--space-5);
    color: var(--color-text-muted);
  }

  @media (width <= 60rem) {
    .agenda-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (width <= 44rem) {
    .view-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .view-heading p,
    .event-row-copy p,
    .series-item p {
      font-size: 1rem;
    }

    .event-filters .filter-action,
    .text-action {
      font-size: 1rem;
    }

    .featured-event {
      grid-template-columns: 1fr;
    }

    .featured-date {
      grid-template-columns: repeat(3, auto);
      justify-content: start;
      gap: var(--space-2);
      border-inline-end: 0;
      text-align: start;
    }

    .featured-date strong {
      font-size: 2rem;
    }

    .featured-actions,
    .row-actions {
      inline-size: 100%;
    }

    .agenda-filter-row {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-2);
    }

    .event-filters {
      inline-size: 100%;
    }

    .event-details {
      display: grid;
      gap: var(--space-3);
    }

    .event-details dt,
    .event-details dd,
    .event-row time span,
    .text-action {
      font-size: 0.875rem;
    }

    .event-row {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }

    .event-row time {
      grid-template-columns: auto auto;
      justify-content: start;
      gap: var(--space-2);
    }

    .series-badge {
      font-size: 0.875rem;
    }

    .series-panel {
      padding: var(--space-4);
    }
  }
}
</style>
