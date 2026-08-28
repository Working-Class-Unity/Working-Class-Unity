<script setup lang="ts">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { useId } from 'vue'

type JoinOption = Readonly<{
  description: string
  disabled?: boolean
  price?: string
  title: string
  value: string
}>

const props = defineProps<{
  disabled?: boolean
  label: string
  options: readonly JoinOption[]
}>()

const model = defineModel<string>({ required: true })
const groupId = useId()

function descriptionId(value: string) {
  return `${groupId}-${value.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}-description`
}
</script>

<template>
  <RadioGroupRoot v-model="model" class="join-option-group" :aria-label="props.label" :disabled="props.disabled">
    <RadioGroupItem
      v-for="option in props.options"
      :key="option.value"
      class="join-option"
      :value="option.value"
      :disabled="props.disabled || option.disabled"
      :aria-label="option.price ? `${option.title}, ${option.price}` : option.title"
      :aria-describedby="descriptionId(option.value)"
    >
      <span class="join-radio" aria-hidden="true">
        <RadioGroupIndicator class="join-radio-indicator" />
      </span>
      <span class="join-option-copy">
        <span class="join-option-heading">
          <span class="join-option-title">{{ option.title }}</span>
          <span v-if="option.price" class="join-option-price">{{ option.price }}</span>
        </span>
        <span :id="descriptionId(option.value)" class="join-option-description">{{ option.description }}</span>
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
@layer components {
  .join-option-group {
    display: grid;
    gap: var(--space-3);
  }

  .join-option {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    min-block-size: 7.25rem;
    inline-size: 100%;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    color: var(--color-text);
    background: var(--color-surface);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .join-option[data-state='checked'] {
    border-color: var(--color-brand-primary);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-brand-primary);
    background: color-mix(in srgb, var(--color-action-soft) 48%, var(--color-surface));
  }

  .join-option:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .join-option:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .join-option:hover:not(:disabled) {
    border-color: var(--color-action);
    background: var(--color-action-soft);
  }

  .join-radio {
    display: grid;
    place-items: center;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    margin-block-start: 0.15rem;
    border: 2px solid var(--color-control-border);
    border-radius: 50%;
    background: var(--color-surface);
  }

  .join-option[data-state='checked'] .join-radio {
    border-color: var(--color-brand-primary);
  }

  .join-radio-indicator {
    display: block;
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: 50%;
    background: var(--color-brand-primary);
  }

  .join-option-copy,
  .join-option-heading {
    display: flex;
    min-width: 0;
  }

  .join-option-copy {
    flex-direction: column;
    gap: var(--space-1);
  }

  .join-option-heading {
    justify-content: space-between;
    gap: var(--space-3);
    align-items: baseline;
  }

  .join-option-title,
  .join-option-price {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.25rem, 1.08rem + 0.45vw, 1.65rem);
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }

  .join-option-price {
    flex: none;
    white-space: nowrap;
  }

  .join-option-description {
    max-inline-size: 48ch;
    color: var(--color-text-muted);
    line-height: 1.45;
  }

  @media (width <= 32rem) {
    .join-option {
      min-block-size: 0;
      padding: var(--space-3);
    }

    .join-option-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-1);
    }
  }
}
</style>
