<script setup lang="ts">
import CalendarDatePicker from '~/components/calendar/CalendarDatePicker.vue'
import EventDirectionsMenu from '~/components/calendar/EventDirectionsMenu.vue'
import EventRsvpDialog from '~/components/calendar/EventRsvpDialog.vue'

type ViewId = 'agenda' | 'month'
type EventKind = 'Organizing' | 'Action' | 'Community' | 'Training'
type CalendarEvent = {
  id: string
  title: string
  kind: EventKind
  dateLabel: string
  startsAt: string
  time: string
  place: string
  address: string
  description: string
  discussionUrl?: string
  recurring?: string
}

const { t } = useI18n()
const activeView = ref<ViewId>('agenda')
const activeFilter = ref('Everything')
const rsvpOpen = ref(false)
const selectedEventName = ref('WCU General Meeting')
const selectedMonthEventId = ref('general-meeting')
const jumpMessage = ref('')

const events: CalendarEvent[] = [
  {
    id: 'general-meeting',
    title: 'WCU General Meeting',
    kind: 'Organizing',
    dateLabel: 'Thu, Aug 20',
    startsAt: '2026-08-20T19:00:00-07:00',
    time: '7:00–8:30 PM',
    place: 'OF Hall',
    address: '2522 Grand Canal Blvd, Stockton, CA',
    description:
      'Our monthly open organizing meeting for campaign decisions, political discussion, and member work. Newcomers are welcome.',
    discussionUrl: '#',
    recurring: 'Third Thursday monthly · 4 more dates'
  },
  {
    id: 'canvass',
    title: 'Tenant rights canvass',
    kind: 'Action',
    dateLabel: 'Sat, Aug 22',
    startsAt: '2026-08-22T10:00:00-07:00',
    time: '10:00 AM–1:00 PM',
    place: 'Victory Park',
    address: '1001 N Pershing Ave, Stockton, CA',
    description: 'Knock doors with experienced organizers and talk with tenants about repairs and rent increases.',
    discussionUrl: '#'
  },
  {
    id: 'game-night',
    title: 'WCU game night',
    kind: 'Community',
    dateLabel: 'Fri, Aug 28',
    startsAt: '2026-08-28T17:30:00-07:00',
    time: '5:30–7:00 PM',
    place: 'Side Hustle Brew',
    address: '2441 S Stockton St, Lodi, CA',
    description: 'Bring a game or join a table. Food is available from Side Hustle Brew.'
  },
  {
    id: 'tabling',
    title: 'Farmers market tabling',
    kind: 'Action',
    dateLabel: 'Fri, Aug 28',
    startsAt: '2026-08-28T19:00:00-07:00',
    time: '7:00–8:30 PM',
    place: 'Lodi Farmers Market',
    address: '502 E Lodi Ave, Lodi, CA',
    description: 'Talk with neighbors about WCU and invite people into upcoming campaigns.'
  },
  {
    id: 'coffee',
    title: 'Coffee with WCU',
    kind: 'Community',
    dateLabel: 'Sat, Sep 12',
    startsAt: '2026-09-12T10:00:00-07:00',
    time: '10:00–11:30 AM',
    place: 'Groundstack Coffee',
    address: '3210 Pacific Ave, Stockton, CA',
    description: 'An informal morning to meet WCU organizers, ask questions, and get connected.',
    recurring: 'Second Saturday monthly · 4 more dates'
  }
]

const agendaEvents = computed(() => {
  const upcoming = events.filter((event) => event.id !== 'general-meeting' && event.id !== 'coffee')
  if (activeFilter.value === 'Everything') return upcoming
  return upcoming.filter((event) => event.kind === activeFilter.value)
})
const featuredEvent = events[0]!
const recurringEvents = events.filter((event) => event.recurring)
const selectedMonthEvent = computed(() => events.find((event) => event.id === selectedMonthEventId.value) ?? events[0]!)

function eventById(eventId: string) {
  return events.find((event) => event.id === eventId)
}

function eventStartTime(time: string) {
  const [start = time, end = ''] = time.split('–')
  const suffix = end.match(/\b(?:AM|PM)\b/)?.[0]
  return /\b(?:AM|PM)\b/.test(start) || !suffix ? start : `${start} ${suffix}`
}

function recurrenceSchedule(event: CalendarEvent) {
  return event.recurring?.split(' · ')[0] ?? ''
}

const monthCells = [
  ['26', true],
  ['27', true],
  ['28', true],
  ['29', true],
  ['30', true],
  ['31', true],
  ['1', false],
  ['2', false],
  ['3', false],
  ['4', false],
  ['5', false],
  ['6', false],
  ['7', false],
  ['8', false],
  ['9', false],
  ['10', false],
  ['11', false],
  ['12', false],
  ['13', false],
  ['14', false],
  ['15', false],
  ['16', false],
  ['17', false],
  ['18', false],
  ['19', false],
  ['20', false, 'general-meeting'],
  ['21', false],
  ['22', false, 'canvass'],
  ['23', false],
  ['24', false],
  ['25', false],
  ['26', false],
  ['27', false],
  ['28', false, 'game-night', 'tabling'],
  ['29', false],
  ['30', false],
  ['31', false],
  ['1', true],
  ['2', true],
  ['3', true],
  ['4', true],
  ['5', true]
] as const

function openRsvp(eventName: string) {
  selectedEventName.value = eventName
  rsvpOpen.value = true
}

function jumpToDate(date: string) {
  jumpMessage.value = `Showing events from ${date}.`
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
        <p class="calendar-eyebrow">WCU calendar</p>
        <h1 id="calendar-title">Find your place in the work</h1>
        <p>
          Come to an organizing meeting, take action with your neighbors, or meet people at a community gathering.
          Newcomers are welcome at every event shown here.
        </p>
      </div>

      <details class="subscribe-menu">
        <summary>
          <span>Sync calendar</span>
          <span class="disclosure-chevron" aria-hidden="true" />
        </summary>
        <div class="subscribe-options">
          <a href="#">Google Calendar</a>
          <a href="#">Apple Calendar</a>
          <a href="#">Outlook</a>
          <button type="button">Copy calendar link</button>
        </div>
      </details>
    </header>

    <div class="calendar-controls">
      <div class="view-tabs" role="group" aria-label="Calendar view">
        <button type="button" :aria-pressed="activeView === 'agenda'" @click="activeView = 'agenda'">Agenda</button>
        <button type="button" :aria-pressed="activeView === 'month'" @click="activeView = 'month'">Month</button>
      </div>
    </div>

    <section v-if="activeView === 'agenda'" class="agenda-view" aria-labelledby="agenda-title">
      <div class="view-heading">
        <div>
          <h2 id="agenda-title">Upcoming events</h2>
          <p>Recurring programs appear once, so the next useful opportunity stays easy to find.</p>
        </div>
        <CalendarDatePicker @select="jumpToDate" />
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
            <span class="type-badge" :class="`type-${featuredEvent.kind.toLowerCase()}`">{{ featuredEvent.kind }}</span>
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
        <div class="featured-actions">
          <button type="button" class="primary-action" @click="openRsvp(featuredEvent.title)">RSVP</button>
          <a v-if="featuredEvent.discussionUrl" class="secondary-action" :href="featuredEvent.discussionUrl">
            Join discussion
          </a>
          <EventDirectionsMenu :address="featuredEvent.address" />
        </div>
      </article>

      <div class="agenda-filter-row">
        <p>Filter upcoming events</p>
        <div class="event-filters" role="group" aria-label="Filter upcoming events">
          <button
            v-for="filter in ['Everything', 'Organizing', 'Action', 'Community', 'Training']"
            :key="filter"
            type="button"
            :aria-pressed="activeFilter === filter"
            @click="activeFilter = filter"
          >
            {{ filter === 'Everything' ? 'All' : filter === 'Action' ? 'Actions' : filter }}
          </button>
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
                  <span class="type-badge" :class="`type-${event.kind.toLowerCase()}`">{{ event.kind }}</span>
                  <span v-if="event.recurring" class="series-badge">Series</span>
                </div>
                <h4>{{ event.title }}</h4>
                <p>{{ event.description }}</p>
                <button v-if="event.recurring" type="button" class="text-action">{{ event.recurring }}</button>
              </div>
              <div class="row-actions">
                <button type="button" class="secondary-action" @click="openRsvp(event.title)">RSVP</button>
                <a v-if="event.discussionUrl" class="secondary-action" :href="event.discussionUrl"> Join discussion </a>
              </div>
            </li>
            <li v-if="agendaEvents.length === 0" class="empty-state">No events match this filter yet.</li>
          </ol>
        </section>

        <aside class="series-panel" aria-labelledby="series-title">
          <p class="section-label">Recurring events</p>
          <h3 id="series-title">More dates</h3>
          <div v-for="event in recurringEvents" :key="event.id" class="series-item">
            <span class="type-badge" :class="`type-${event.kind.toLowerCase()}`">{{ event.kind }}</span>
            <h4>{{ event.title }}</h4>
            <p>{{ recurrenceSchedule(event) }} · {{ eventStartTime(event.time) }}</p>
            <button type="button" class="text-action">See 4 upcoming dates</button>
          </div>
        </aside>
      </div>
    </section>

    <section v-else class="month-view" aria-labelledby="month-title">
      <div class="view-heading">
        <div>
          <h2 id="month-title">Month view</h2>
          <p>Select an event—not just a day—to see its full details.</p>
        </div>
      </div>
      <div class="month-toolbar">
        <button type="button">Previous</button>
        <h3>August 2026</h3>
        <button type="button">Next</button>
      </div>
      <div class="month-layout">
        <div class="month-grid-wrap">
          <div class="month-grid" aria-label="August 2026 events">
            <div v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="weekday">
              {{ day }}
            </div>
            <div
              v-for="(cell, index) in monthCells"
              :key="index"
              class="month-cell"
              :class="{ 'outside-month': cell[1] }"
            >
              <span class="day-number">{{ cell[0] }}</span>
              <button
                v-for="eventId in cell.slice(2)"
                :key="eventId"
                type="button"
                class="calendar-event"
                :class="`event-${eventById(eventId)?.kind.toLowerCase()}`"
                :aria-pressed="selectedMonthEventId === eventId"
                :aria-label="`${eventById(eventId)?.title}, August ${cell[0]}`"
                @click="selectedMonthEventId = eventId"
              >
                {{ eventById(eventId)?.title }}
              </button>
            </div>
          </div>
        </div>

        <aside class="event-inspector" aria-labelledby="selected-event-title">
          <h3 id="selected-event-title">{{ selectedMonthEvent.title }}</h3>
          <span class="type-badge" :class="`type-${selectedMonthEvent.kind.toLowerCase()}`">{{
            selectedMonthEvent.kind
          }}</span>
          <p class="selected-time">{{ selectedMonthEvent.dateLabel }} · {{ selectedMonthEvent.time }}</p>
          <p>{{ selectedMonthEvent.place }} · {{ selectedMonthEvent.address }}</p>
          <p>{{ selectedMonthEvent.description }}</p>
          <p v-if="selectedMonthEvent.recurring" class="recurrence-note">{{ selectedMonthEvent.recurring }}</p>
          <div class="inspector-actions">
            <button type="button" class="primary-action" @click="openRsvp(selectedMonthEvent.title)">RSVP</button>
            <a v-if="selectedMonthEvent.discussionUrl" class="secondary-action" :href="selectedMonthEvent.discussionUrl"
              >Join discussion</a
            >
            <EventDirectionsMenu :address="selectedMonthEvent.address" />
          </div>
        </aside>
      </div>
    </section>

    <EventRsvpDialog v-model:open="rsvpOpen" :event-name="selectedEventName" />
  </section>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- shared control and type families intentionally precede state variants */
@layer components {
  .calendar-page {
    display: grid;
    gap: var(--space-7);
    padding-block: clamp(2.5rem, 5vw, 4.5rem);
  }

  .calendar-heading,
  .view-heading,
  .section-heading-row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .heading-copy h1,
  .view-heading h2,
  .featured-copy h3,
  .event-inspector h3 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-weight: 650;
    letter-spacing: -0.035em;
  }

  .heading-copy h1 {
    max-inline-size: 20ch;
    margin: 0;
    font-size: clamp(2.75rem, 5.5vw, 4.5rem);
  }

  .heading-copy > p:last-child {
    max-inline-size: 62ch;
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
    font-size: clamp(1rem, 1.5vw, 1.125rem);
    line-height: 1.55;
  }

  .calendar-eyebrow,
  .section-label {
    margin: 0 0 var(--space-2);
    color: var(--color-brand-accent);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .subscribe-menu {
    position: relative;
    flex: 0 0 auto;
  }

  .subscribe-menu summary {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--color-action);
    border-radius: var(--radius-2);
    padding: 0.6rem 0.8rem;
    color: var(--color-action);
    background: var(--color-surface);
    font-weight: 650;
    list-style: none;
    cursor: pointer;
  }

  .subscribe-menu summary::-webkit-details-marker {
    display: none;
  }

  .disclosure-chevron {
    inline-size: 0.45rem;
    block-size: 0.45rem;
    border-block-end: 1.5px solid currentcolor;
    border-inline-end: 1.5px solid currentcolor;
    rotate: 45deg;
    translate: 0 -0.1rem;
  }

  .subscribe-menu[open] .disclosure-chevron {
    rotate: 225deg;
    translate: 0 0.1rem;
  }

  .subscribe-options {
    position: absolute;
    z-index: var(--z-menu);
    inset-block-start: calc(100% + var(--space-2));
    inset-inline-end: 0;
    display: grid;
    min-inline-size: 14rem;
    border-radius: var(--radius-3);
    padding: var(--space-2);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
    outline: 1px solid var(--color-divider);
  }

  .subscribe-options a,
  .subscribe-options button {
    display: flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    border: 0;
    border-radius: var(--radius-2);
    padding: 0.65rem 0.75rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }

  .subscribe-menu summary:hover,
  .subscribe-options a:hover,
  .subscribe-options button:hover {
    background: var(--color-action-soft);
  }

  .calendar-controls {
    border-block-end: 1px solid var(--color-divider);
  }

  .view-tabs {
    display: flex;
    gap: var(--space-5);
  }

  .view-tabs button,
  .event-filters button,
  .month-toolbar button {
    min-block-size: var(--control-min-block-size);
    border: 0;
    padding: 0.6rem 0.25rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }

  .view-tabs button {
    border-radius: var(--radius-1) var(--radius-1) 0 0;
  }

  .view-tabs button[aria-pressed='true'] {
    box-shadow: inset 0 -2px var(--color-action);
  }

  .view-tabs button:hover,
  .month-toolbar button:hover {
    background: var(--color-action-soft);
  }

  .agenda-view,
  .month-view {
    display: grid;
    gap: var(--space-6);
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

  .type-badge,
  .series-badge {
    display: inline-flex;
    min-block-size: 1.625rem;
    align-items: center;
    border-radius: var(--radius-round);
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 650;
  }

  .type-organizing {
    color: var(--color-event-organizing-text);
    background: var(--color-event-organizing-surface);
  }

  .type-action {
    color: var(--color-event-action-text);
    background: var(--color-event-action-surface);
  }

  .type-community {
    color: var(--color-event-community-text);
    background: var(--color-event-community-surface);
  }

  .type-training {
    color: var(--color-event-training-text);
    background: var(--color-event-training-surface);
  }

  .series-badge {
    color: var(--color-neutral-tag-text);
    background: var(--color-neutral-tag-surface);
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

  .featured-actions,
  .inspector-actions,
  .row-actions {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-2);
  }

  .featured-actions {
    inline-size: 10.5rem;
  }

  .inspector-actions,
  .row-actions {
    inline-size: 9.5rem;
  }

  .primary-action,
  .secondary-action {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-2);
    padding: 0.6rem 0.75rem;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    text-decoration: none;
    cursor: pointer;
  }

  .primary-action {
    border: 1px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .primary-action:hover {
    border-color: var(--color-accent-action-hover);
    background: var(--color-accent-action-hover);
  }

  .secondary-action {
    border: 1px solid var(--color-action);
    color: var(--color-action);
    background: transparent;
  }

  .secondary-action:hover {
    background: var(--color-action-soft);
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

  .event-filters button {
    border-radius: var(--radius-2);
    padding-inline: 0.75rem;
    color: var(--color-text-muted);
  }

  .event-filters button:hover,
  .event-filters button[aria-pressed='true'] {
    color: var(--color-action);
    background: var(--color-action-soft);
  }

  .event-filters button[aria-pressed='true'] {
    box-shadow: inset 0 0 0 1px var(--color-action);
  }

  .agenda-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: var(--space-7);
    align-items: start;
  }

  .section-heading-row h3,
  .series-panel h3,
  .month-toolbar h3 {
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

  .text-action {
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
    cursor: pointer;
  }

  .text-action:hover {
    color: var(--color-accent-action-hover);
  }

  .series-panel,
  .event-inspector {
    border-radius: var(--radius-3);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
  }

  .series-panel {
    display: grid;
    gap: var(--space-4);
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

  .month-toolbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: var(--space-4);
    border-block-end: 1px solid var(--color-divider);
    padding-block-end: var(--space-4);
  }

  .month-toolbar button:first-child {
    justify-self: start;
  }

  .month-toolbar button:last-child {
    justify-self: end;
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

  .calendar-event {
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
    cursor: pointer;
  }

  .calendar-event + .calendar-event {
    margin-block-start: var(--space-1);
  }

  .event-organizing {
    background: var(--color-event-organizing-surface);
  }

  .event-action {
    background: var(--color-event-action-surface);
  }

  .event-community {
    background: var(--color-event-community-surface);
  }

  .event-training {
    background: var(--color-event-training-surface);
  }

  .calendar-event:hover {
    box-shadow: inset 0 0 0 1px var(--color-action);
  }

  .calendar-event[aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px var(--color-action);
  }

  .event-inspector {
    position: sticky;
    inset-block-start: var(--space-4);
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
    margin-block-start: var(--space-5);
  }

  @media (width <= 60rem) {
    .agenda-layout,
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
    .calendar-page {
      gap: var(--space-6);
      padding-block: var(--space-7);
    }

    .calendar-heading,
    .view-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .heading-copy h1 {
      font-size: 2.75rem;
    }

    .heading-copy > p:last-child,
    .view-heading p,
    .event-row-copy p,
    .series-item p,
    .event-inspector > p {
      font-size: 1rem;
    }

    .subscribe-menu {
      align-self: start;
    }

    .subscribe-options {
      inset-inline: 0 auto;
      inline-size: min(15rem, calc(100vw - 2rem));
      min-inline-size: 0;
    }

    .subscribe-options a,
    .subscribe-options button,
    .view-tabs button,
    .event-filters button,
    .primary-action,
    .secondary-action,
    .text-action {
      font-size: 1rem;
    }

    .view-tabs {
      gap: var(--space-4);
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
    .inspector-actions,
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

    .type-badge,
    .series-badge,
    .calendar-event {
      font-size: 0.875rem;
    }

    .series-panel,
    .event-inspector {
      padding: var(--space-4);
    }
  }
}
/* stylelint-enable no-descending-specificity */
</style>
