<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'

const props = defineProps<{ address: string; googleUrl?: string; appleUrl?: string }>()
const { t } = useI18n()
const copied = ref(false)
const googleMapsUrl = computed(
  () => props.googleUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(props.address)}`
)
const appleMapsUrl = computed(() => props.appleUrl ?? `https://maps.apple.com/?q=${encodeURIComponent(props.address)}`)

async function copyAddress() {
  if (!import.meta.client) return
  await navigator.clipboard.writeText(props.address)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>
  <div class="wcu-directions-root">
    <DropdownMenuRoot>
      <DropdownMenuTrigger as-child>
        <AppButton class="wcu-directions-trigger" size="compact" variant="secondary">
          <span>{{ t('calendar.directions.title') }}</span>
          <span class="wcu-directions-chevron" aria-hidden="true" />
        </AppButton>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          class="wcu-directions-menu"
          :side-offset="8"
          :collision-padding="10"
          :prioritize-position="true"
          align="end"
        >
          <DropdownMenuLabel class="wcu-directions-label">{{ address }}</DropdownMenuLabel>
          <DropdownMenuSeparator class="wcu-directions-separator" />
          <DropdownMenuItem as-child>
            <a class="wcu-directions-item" :href="googleMapsUrl" target="_blank" rel="noreferrer">Google Maps</a>
          </DropdownMenuItem>
          <DropdownMenuItem as-child>
            <a class="wcu-directions-item" :href="appleMapsUrl" target="_blank" rel="noreferrer">Apple Maps</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator class="wcu-directions-separator" />
          <DropdownMenuItem as-child @select="copyAddress">
            <AppButton class="wcu-directions-item" size="compact" variant="secondary">
              {{ copied ? t('calendar.directions.copied') : t('calendar.directions.copy') }}
            </AppButton>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
    <span class="visually-hidden" aria-live="polite">{{
      copied ? t('calendar.directions.copiedAnnouncement') : ''
    }}</span>
  </div>
</template>

<style>
@layer components {
  .wcu-directions-root {
    inline-size: 100%;
  }

  .wcu-directions-root .wcu-directions-trigger[data-variant='secondary'] {
    display: inline-flex;
    inline-size: 100%;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid var(--color-action);
    border-radius: var(--radius-2);
    padding: 0.6rem 0.9rem;
    background: transparent;
    color: var(--color-action);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .wcu-directions-chevron {
    inline-size: 0.45rem;
    block-size: 0.45rem;
    border-block-end: 1.5px solid currentcolor;
    border-inline-end: 1.5px solid currentcolor;
    rotate: 45deg;
    translate: 0 -0.1rem;
    transition: rotate var(--motion-duration-fast) ease;
  }

  .wcu-directions-root .wcu-directions-trigger[data-variant='secondary'][data-state='open'] .wcu-directions-chevron {
    rotate: 225deg;
    translate: 0 0.1rem;
  }

  .wcu-directions-menu {
    z-index: 60;
    inline-size: min(17rem, var(--reka-dropdown-menu-content-available-width));
    max-block-size: var(--reka-dropdown-menu-content-available-height);
    overflow: auto;
    border-radius: var(--radius-3);
    padding: var(--space-2);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
    outline: 1px solid var(--color-divider);
  }

  .wcu-directions-label {
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .wcu-directions-separator {
    block-size: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--color-divider);
  }

  .wcu-directions-item {
    display: flex;
    inline-size: 100%;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    border-radius: var(--radius-2);
    padding: 0.65rem 0.75rem;
    background: transparent;
    color: var(--color-action);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    text-align: start;
    text-decoration: none;
    outline: none;
    cursor: pointer;
  }

  .wcu-directions-item[data-variant='secondary'] {
    border: 0;
    color: var(--color-action);
    background: transparent;
    filter: none;
  }

  .wcu-directions-root .wcu-directions-trigger[data-variant='secondary']:hover,
  .wcu-directions-item[data-highlighted] {
    background: var(--color-action-soft);
  }

  .wcu-directions-root .wcu-directions-trigger[data-variant='secondary']:focus-visible,
  .wcu-directions-item:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  @media (width <= 36rem) {
    .wcu-directions-trigger,
    .wcu-directions-item {
      font-size: 1rem;
    }

    .wcu-directions-label {
      font-size: 0.875rem;
    }
  }
}
</style>
