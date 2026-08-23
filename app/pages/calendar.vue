<script setup lang="ts">
import CalendarAgendaView from '~/components/calendar/CalendarAgendaView.vue'
import CalendarMonthView from '~/components/calendar/CalendarMonthView.vue'
import EventRsvpDialog from '~/components/calendar/EventRsvpDialog.vue'
import { calendarEvents, calendarMonthCells, type CalendarFilter, type CalendarViewId } from '~/content/calendar'

const { t } = useI18n()
const activeView = ref<CalendarViewId>('agenda')
const activeFilter = ref<CalendarFilter>('Everything')
const rsvpOpen = ref(false)
const selectedEventName = ref('WCU General Meeting')
const selectedMonthEventId = ref('general-meeting')
const jumpMessage = ref('')

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
          <AppButton class="subscribe-action" size="compact" variant="secondary">Copy calendar link</AppButton>
        </div>
      </details>
    </header>

    <div class="calendar-controls">
      <div class="view-tabs" role="group" aria-label="Calendar view">
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'agenda'"
          @click="activeView = 'agenda'"
        >
          Agenda
        </AppButton>
        <AppButton
          class="view-action"
          size="compact"
          variant="secondary"
          :aria-pressed="activeView === 'month'"
          @click="activeView = 'month'"
        >
          Month
        </AppButton>
      </div>
    </div>

    <CalendarAgendaView
      v-if="activeView === 'agenda'"
      v-model:active-filter="activeFilter"
      :events="calendarEvents"
      :jump-message="jumpMessage"
      @jump="jumpToDate"
      @rsvp="openRsvp"
    />
    <CalendarMonthView
      v-else
      v-model:selected-event-id="selectedMonthEventId"
      :cells="calendarMonthCells"
      :events="calendarEvents"
      @rsvp="openRsvp"
    />

    <EventRsvpDialog v-model:open="rsvpOpen" :event-name="selectedEventName" />
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
  .subscribe-options .subscribe-action[data-variant='secondary'] {
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
    filter: none;
    cursor: pointer;
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

  .subscribe-menu summary:hover,
  .subscribe-options a:hover,
  .subscribe-options .subscribe-action[data-variant='secondary']:hover {
    background: var(--color-action-soft);
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

    .subscribe-menu {
      align-self: start;
    }

    .subscribe-options {
      inset-inline: 0 auto;
      inline-size: min(15rem, calc(100vw - 2rem));
      min-inline-size: 0;
    }

    .subscribe-options a,
    .subscribe-options .subscribe-action,
    .view-tabs .view-action {
      font-size: 1rem;
    }

    .view-tabs {
      gap: var(--space-4);
    }
  }
}
</style>
