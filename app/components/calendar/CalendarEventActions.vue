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

const emit = defineEmits<{ rsvp: [event: CalendarEvent] }>()
</script>

<template>
  <div class="calendar-event-actions">
    <AppButton
      size="compact"
      :variant="props.rsvpVariant === 'primary' ? 'primary' : 'secondary'"
      :class="props.rsvpVariant === 'primary' ? 'primary-action' : 'secondary-action'"
      @click="emit('rsvp', event)"
    >
      RSVP
    </AppButton>
    <a v-if="event.discussionUrl" class="secondary-action" :href="event.discussionUrl">Join discussion</a>
    <EventDirectionsMenu v-if="props.showDirections" :address="event.address" />
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

  .calendar-event-actions .primary-action[data-variant='primary'] {
    border: 1px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .calendar-event-actions .primary-action[data-variant='primary']:hover {
    border-color: var(--color-accent-action-hover);
    background: var(--color-accent-action-hover);
  }

  .calendar-event-actions :is(a.secondary-action, .secondary-action[data-variant='secondary']) {
    border: 1px solid var(--color-action);
    color: var(--color-action);
    background: transparent;
  }

  .calendar-event-actions :is(a.secondary-action, .secondary-action[data-variant='secondary']):hover {
    background: var(--color-action-soft);
  }

  @media (width <= 44rem) {
    .calendar-event-actions :is(.primary-action, .secondary-action) {
      font-size: 1rem;
    }
  }
}
</style>
