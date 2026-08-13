<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'

const props = defineProps<{ open: boolean; eventName: string }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const complete = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) complete.value = false
  }
)

function submitRsvp() {
  complete.value = true
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="rsvp-overlay" />
      <DialogContent class="rsvp-dialog">
        <template v-if="!complete">
          <DialogTitle class="dialog-title">RSVP for {{ eventName }}</DialogTitle>
          <DialogDescription class="dialog-description">
            Your WCU profile information is filled in. Check it before confirming.
          </DialogDescription>

          <!-- eslint-disable vue/html-self-closing -->
          <form class="rsvp-form" @submit.prevent="submitRsvp">
            <fieldset class="form-section">
              <legend>Contact information</legend>
              <div class="form-grid">
                <label>
                  <span>Name</span>
                  <input name="name" type="text" autocomplete="name" value="Jordan Lee" required />
                </label>
                <label>
                  <span>Email</span>
                  <input name="email" type="email" autocomplete="email" value="jordan@example.org" required />
                </label>
                <label class="field-full">
                  <span>Mobile phone</span>
                  <input name="phone" type="tel" autocomplete="tel" value="(209) 555-0142" />
                </label>
              </div>
            </fieldset>

            <label class="consent-row">
              <input name="sms_permission" type="checkbox" />
              <span>
                <strong>Text me event updates</strong>
                <span class="consent-help">Optional. Message and data rates may apply.</span>
              </span>
            </label>

            <p class="privacy-note">
              Your RSVP is sent securely to Solidarity Tech. Your contact information is not shown publicly.
            </p>
            <div class="dialog-actions">
              <DialogClose as-child><button type="button" class="button-secondary">Cancel</button></DialogClose>
              <button type="submit" class="button-primary">Confirm RSVP</button>
            </div>
          </form>
          <!-- eslint-enable vue/html-self-closing -->
        </template>
        <template v-else>
          <DialogTitle class="dialog-title">You’re registered</DialogTitle>
          <DialogDescription class="dialog-description">
            We’ll email you details and organizer updates for {{ eventName }}.
          </DialogDescription>
          <div class="dialog-actions">
            <DialogClose as-child><button type="button" class="button-primary">Done</button></DialogClose>
          </div>
        </template>
        <DialogClose class="dialog-close" :aria-label="complete ? 'Close confirmation' : 'Close RSVP form'">
          <span class="dialog-close-mark" aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- form and dialog state variants intentionally follow shared rules */
@layer components {
  .rsvp-overlay {
    position: fixed;
    z-index: 70;
    inset: 0;
    background: var(--color-overlay);
  }

  .rsvp-dialog {
    position: fixed;
    z-index: 71;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    inline-size: min(31rem, calc(100vw - 2rem));
    max-block-size: calc(100dvh - 2rem);
    overflow-y: auto;
    translate: -50% -50%;
    border-radius: var(--radius-3);
    padding: clamp(1.25rem, 4vw, 1.75rem);
    background: var(--color-surface);
    box-shadow: var(--shadow-dialog);
    outline: 1px solid var(--color-divider);
  }

  .dialog-title {
    max-inline-size: 24ch;
    margin: 0;
    padding-inline-end: 3rem;
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.75rem, 5vw, 2.125rem);
    font-weight: 650;
    letter-spacing: -0.035em;
  }

  .dialog-description,
  .privacy-note {
    color: var(--color-text-muted);
    line-height: 1.55;
  }

  .dialog-description {
    max-inline-size: 44ch;
    margin: var(--space-2) 0 var(--space-5);
  }

  .rsvp-form {
    display: grid;
    gap: var(--space-4);
  }

  .form-section {
    min-inline-size: 0;
    margin: 0;
    border: 0;
    padding: 0;
  }

  .form-section legend {
    margin-block-end: var(--space-3);
    padding: 0;
    color: var(--color-brand-primary);
    font-size: 0.875rem;
    font-weight: 650;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .form-grid label {
    display: grid;
    gap: var(--space-2);
    color: var(--color-text);
    font-size: 0.875rem;
    font-weight: 650;
  }

  .field-full {
    grid-column: 1 / -1;
  }

  .form-grid input {
    min-block-size: var(--control-min-block-size);
    border-color: var(--color-control-border);
    padding: 0.65rem 0.75rem;
    color: var(--color-text);
    background: var(--color-surface);
    font: inherit;
    font-weight: 400;
  }

  .form-grid input:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -1px;
  }

  .consent-row {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr);
    align-items: start;
    gap: var(--space-3);
    color: var(--color-text);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.5;
  }

  .consent-row input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    accent-color: var(--color-brand-primary);
  }

  .consent-row > span {
    display: grid;
    gap: var(--space-1);
  }

  .consent-row strong {
    color: var(--color-text);
    font-weight: 650;
  }

  .consent-help {
    color: var(--color-text-muted);
    font-size: 0.8125rem;
  }

  .privacy-note {
    margin: 0;
    font-size: 0.875rem;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    border-block-start: 1px solid var(--color-divider);
    padding-block-start: var(--space-4);
  }

  .dialog-description + .dialog-actions {
    margin-block-start: var(--space-5);
  }

  .dialog-actions button,
  .dialog-close {
    min-block-size: var(--control-min-block-size);
    border-radius: var(--radius-2);
    padding: 0.65rem 0.875rem;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    cursor: pointer;
  }

  .button-primary {
    border: 1px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .button-primary:hover {
    border-color: var(--color-accent-action-hover);
    background: var(--color-accent-action-hover);
  }

  .button-secondary {
    border: 1px solid var(--color-action);
    color: var(--color-action);
    background: transparent;
  }

  .button-secondary:hover,
  .dialog-close:hover {
    background: var(--color-action-soft);
  }

  .dialog-close {
    position: absolute;
    inset-block-start: var(--space-3);
    inset-inline-end: var(--space-3);
    inline-size: var(--control-min-inline-size);
    display: grid;
    place-items: center;
    border: 0;
    padding: 0;
    color: var(--color-text-muted);
    background: transparent;
  }

  .dialog-close-mark {
    position: relative;
    display: block;
    inline-size: 1rem;
    block-size: 1rem;
  }

  .dialog-close-mark::before,
  .dialog-close-mark::after {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0;
    inline-size: 1rem;
    block-size: 1.5px;
    content: '';
    background: currentcolor;
  }

  .dialog-close-mark::before {
    rotate: 45deg;
  }

  .dialog-close-mark::after {
    rotate: -45deg;
  }

  @media (width <= 36rem) {
    .rsvp-dialog {
      inline-size: calc(100vw - 1rem);
      max-block-size: calc(100dvh - 1rem);
    }

    .form-grid {
      grid-template-columns: 1fr;
    }

    .field-full {
      grid-column: auto;
    }

    .dialog-description,
    .form-section legend,
    .form-grid label,
    .form-grid input,
    .consent-row,
    .privacy-note,
    .dialog-actions button {
      font-size: 1rem;
    }

    .consent-help {
      font-size: 0.875rem;
    }

    .dialog-actions {
      align-items: stretch;
      flex-direction: column-reverse;
    }

    .dialog-actions button {
      inline-size: 100%;
    }
  }
}
/* stylelint-enable no-descending-specificity */
</style>
