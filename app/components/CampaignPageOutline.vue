<script setup lang="ts">
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger
} from 'reka-ui'

defineProps<{
  items: readonly Readonly<{
    id: string
    label: string
  }>[]
  label: string
}>()
</script>

<template>
  <div class="campaign-page-outline">
    <aside class="campaign-page-outline-desktop">
      <p>ON THIS PAGE</p>
      <nav :aria-label="label">
        <ol>
          <li v-for="(item, index) in items" :key="item.id">
            <a :href="`#${item.id}`">
              <span aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
              {{ item.label }}
            </a>
          </li>
        </ol>
      </nav>
    </aside>

    <DrawerRoot>
      <DrawerTrigger as-child>
        <button class="campaign-page-outline-trigger" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M3 5h2M8 5h9M3 10h2M8 10h9M3 15h2M8 15h9" />
          </svg>
          On this page
        </button>
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerOverlay class="campaign-page-outline-overlay" />
        <DrawerContent class="campaign-page-outline-drawer">
          <DrawerHandle class="campaign-page-outline-handle" />
          <div class="campaign-page-outline-content">
            <div class="campaign-page-outline-heading">
              <div>
                <DrawerTitle>On this page</DrawerTitle>
                <DrawerDescription>Jump to a section of this page.</DrawerDescription>
              </div>
              <DrawerClose class="campaign-page-outline-close" aria-label="Close page outline">×</DrawerClose>
            </div>

            <nav :aria-label="label">
              <ol>
                <li v-for="(item, index) in items" :key="item.id">
                  <DrawerClose as-child>
                    <a :href="`#${item.id}`">
                      <span aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                      {{ item.label }}
                    </a>
                  </DrawerClose>
                </li>
              </ol>
            </nav>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </div>
</template>

<style>
@layer components {
  .campaign-page-outline {
    position: sticky;
    inset-block-start: var(--space-5);
    min-width: 0;
    padding-block: clamp(4rem, 8vw, 7rem);
  }

  .campaign-page-outline-desktop {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .campaign-page-outline-desktop > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-page-outline-desktop nav {
    min-width: 0;
  }

  .campaign-page-outline-desktop ol,
  .campaign-page-outline-content ol {
    display: grid;
    gap: var(--space-1);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .campaign-page-outline-desktop a {
    display: grid;
    grid-template-columns: 1.75rem minmax(0, 1fr);
    gap: var(--space-2);
    border-radius: var(--radius-1);
    padding: var(--space-2);
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.4;
    text-decoration: none;
  }

  .campaign-page-outline-content a {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    min-block-size: var(--control-min-block-size);
    border-block-start: var(--border-width) solid var(--color-border);
    padding-block: var(--space-4);
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
    line-height: 1.4;
    text-decoration: none;
  }

  .campaign-page-outline-desktop a span,
  .campaign-page-outline-content a span {
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  }

  .campaign-page-outline-desktop a:hover,
  .campaign-page-outline-desktop a:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .campaign-page-outline-trigger {
    position: fixed;
    z-index: calc(var(--z-menu) + 1);
    inset-inline-end: max(var(--space-4), env(safe-area-inset-right, 0px));
    inset-block-end: max(var(--space-4), env(safe-area-inset-bottom, 0px));
    display: none;
    align-items: center;
    gap: var(--space-2);
    min-block-size: var(--control-min-block-size);
    border: var(--border-width) solid var(--color-brand-primary);
    border-radius: var(--radius-round);
    padding-inline: var(--space-4);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
    box-shadow: var(--shadow-panel);
    font: inherit;
    font-size: 0.875rem;
    font-weight: var(--font-weight-strong);
    cursor: pointer;
  }

  .campaign-page-outline-trigger svg {
    inline-size: 1.125rem;
    block-size: 1.125rem;
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-width: 1.75;
  }

  .campaign-page-outline-trigger:hover,
  .campaign-page-outline-trigger:focus-visible,
  .campaign-page-outline-trigger[data-state='open'] {
    color: var(--color-brand-primary);
    background: var(--color-brand-highlight);
  }

  .campaign-page-outline-trigger:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-page-outline-overlay {
    position: fixed;
    z-index: 80;
    inset: 0;
    background: rgb(4 51 79 / 58%);
  }

  .campaign-page-outline-drawer {
    --outline-drawer-bleed: 3rem;

    position: fixed;
    z-index: 81;
    inset-inline: 0;
    inset-block-end: 0;
    max-block-size: min(82dvh, 42rem);
    overflow-y: auto;
    border-start-start-radius: var(--radius-2);
    border-start-end-radius: var(--radius-2);
    padding-block-end: calc(env(safe-area-inset-bottom, 0px) + var(--outline-drawer-bleed));
    margin-block-end: calc(-1 * var(--outline-drawer-bleed));
    color: var(--color-text);
    background: var(--color-surface);
    transform: translateY(var(--drawer-swipe-movement-y, 0));
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-page-outline-drawer[data-state='open'] {
    animation: campaign-outline-in 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-page-outline-drawer[data-state='closed'] {
    animation: campaign-outline-out 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-page-outline-drawer[data-swiping] {
    transition-duration: 0s;
  }

  .campaign-page-outline-handle {
    inline-size: 3rem;
    block-size: 0.3rem;
    border-radius: var(--radius-round);
    margin: var(--space-3) auto 0;
    background: var(--color-border);
  }

  .campaign-page-outline-content {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5) var(--content-gutter) var(--space-6);
  }

  .campaign-page-outline-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: start;
  }

  .campaign-page-outline-heading > div {
    display: grid;
    gap: var(--space-1);
  }

  .campaign-page-outline-heading h2,
  .campaign-page-outline-heading p {
    margin: 0;
  }

  .campaign-page-outline-heading h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.03em;
  }

  .campaign-page-outline-heading p {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .campaign-page-outline-close {
    display: grid;
    place-items: center;
    inline-size: var(--control-min-inline-size);
    block-size: var(--control-min-block-size);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-1);
    padding: 0;
    color: var(--color-brand-primary);
    background: transparent;
    font: inherit;
    font-size: 1.5rem;
    cursor: pointer;
  }

  .campaign-page-outline-close:hover,
  .campaign-page-outline-close:focus-visible {
    background: var(--color-action-soft);
  }

  .campaign-page-outline-content a:hover,
  .campaign-page-outline-content a:focus-visible {
    color: var(--color-accent-action);
  }

  @keyframes campaign-outline-in {
    from {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @keyframes campaign-outline-out {
    to {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @media (width <= 56rem) {
    .campaign-page-outline {
      position: static;
      block-size: 0;
      padding: 0;
    }

    .campaign-page-outline-desktop {
      display: none;
    }

    .campaign-page-outline-trigger {
      display: inline-flex;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .campaign-page-outline-drawer {
      animation-duration: 1ms;
      transition-duration: 1ms;
    }
  }
}
</style>
