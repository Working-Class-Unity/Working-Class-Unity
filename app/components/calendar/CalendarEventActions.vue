<script setup lang="ts">
import EventDirectionsMenu from '~/components/calendar/EventDirectionsMenu.vue'
import type { CalendarEvent } from '~/content/calendar'

const props = withDefaults(
  defineProps<{
    event: CalendarEvent
    rsvpVariant?: 'primary' | 'secondary'
    showDirections?: boolean
  }>(),
  {
    rsvpVariant: 'primary',
    showDirections: false
  }
)
const { t } = useI18n()
</script>

<template>
  <div class="calendar-event-actions">
    <a
      v-if="event.rsvpUrl"
      :href="event.rsvpUrl"
      :class="props.rsvpVariant === 'primary' ? 'primary-action' : 'secondary-action'"
      target="_blank"
      rel="noreferrer"
    >
      {{ t('calendar.actions.rsvp') }}
    </a>
    <a
      v-if="event.eventPageUrl && event.eventPageUrl !== event.rsvpUrl"
      class="secondary-action"
      :href="event.eventPageUrl"
      target="_blank"
      rel="noreferrer"
    >
      {{ t('calendar.actions.details') }}
    </a>
    <EventDirectionsMenu v-if="props.showDirections && event.address" :address="event.address" />
  </div>
</template>

<style scoped>
@layer components {
  .calendar-event-actions {
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-2);
  }

  .calendar-event-actions :is(.primary-action, .secondary-action) {
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
    filter: none;
    cursor: pointer;
  }

  .calendar-event-actions .primary-action {
    border: 1px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .calendar-event-actions .primary-action:hover {
    border-color: var(--color-accent-action-hover);
    background: var(--color-accent-action-hover);
  }

  .calendar-event-actions .secondary-action {
    border: 1px solid var(--color-action);
    color: var(--color-action);
    background: transparent;
  }

  .calendar-event-actions .secondary-action:hover {
    background: var(--color-action-soft);
  }

  @media (width <= 44rem) {
    .calendar-event-actions :is(.primary-action, .secondary-action) {
      font-size: 1rem;
    }
  }
}
</style>
