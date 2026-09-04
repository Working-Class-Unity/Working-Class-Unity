<script setup lang="ts">
import type { CalendarEventKind } from '~/content/calendar'

const props = defineProps<{ kind: CalendarEventKind }>()
const { t } = useI18n()

const kindClass = computed(() => `type-${props.kind.toLowerCase()}`)
</script>

<template>
  <span class="type-badge" :class="kindClass">{{ t(`calendar.kinds.${kind.toLowerCase()}`) }}</span>
</template>

<style scoped>
@layer components {
  .type-badge {
    display: inline-flex;
    min-block-size: 1.625rem;
    align-items: center;
    border-radius: var(--radius-round);
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 650;
  }

  .type-meeting {
    color: var(--color-event-organizing-text);
    background: var(--color-event-organizing-surface);
  }

  .type-action {
    color: var(--color-event-action-text);
    background: var(--color-event-action-surface);
  }

  .type-social {
    color: var(--color-event-community-text);
    background: var(--color-event-community-surface);
  }

  .type-learning {
    color: var(--color-event-training-text);
    background: var(--color-event-training-surface);
  }

  @media (width <= 44rem) {
    .type-badge {
      font-size: 0.875rem;
    }
  }
}
</style>
