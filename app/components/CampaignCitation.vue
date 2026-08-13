<script setup lang="ts">
import {
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
  HoverCardArrow,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger
} from 'reka-ui'
import type { CampaignSource } from '~/content/remove-flock-stockton'

const props = defineProps<{
  number: number
  noteId: string
  source: CampaignSource
}>()

const sourceMetadata = computed(() =>
  [props.source.publisher, props.source.published].filter((value) => Boolean(value)).join(' · ')
)

const drawerOpen = ref(false)
const noteJumpPending = ref(false)

function readFullNote() {
  noteJumpPending.value = true
  drawerOpen.value = false
}

function onDrawerCloseAutoFocus(event: Event) {
  if (!noteJumpPending.value) return

  event.preventDefault()
  noteJumpPending.value = false
  const target = document.getElementById(props.noteId)
  if (!target) return

  history.pushState(null, '', `#${props.noteId}`)
  target.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
}
</script>

<template>
  <HoverCardRoot :open-delay="180" :close-delay="120">
    <HoverCardTrigger as-child>
      <a
        class="campaign-citation-trigger campaign-citation-trigger--desktop"
        :href="`#${noteId}`"
        :aria-label="`Citation ${number}: ${source.title}`"
      >
        <sup>{{ number }}</sup>
      </a>
    </HoverCardTrigger>
    <HoverCardPortal>
      <HoverCardContent
        class="campaign-citation-card"
        side="top"
        align="start"
        :side-offset="10"
        :collision-padding="16"
      >
        <HoverCardArrow class="campaign-citation-card-arrow" :width="14" :height="7" />
        <p class="campaign-citation-label">SOURCE {{ number }}</p>
        <p class="campaign-citation-title">{{ source.title }}</p>
        <p class="campaign-citation-meta">{{ sourceMetadata }}</p>
        <p v-if="source.note" class="campaign-citation-note">{{ source.note }}</p>
        <a class="campaign-citation-source-link" :href="source.url" target="_blank" rel="noreferrer"> View source </a>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>

  <DrawerRoot v-model:open="drawerOpen">
    <DrawerTrigger as-child>
      <button
        class="campaign-citation-trigger campaign-citation-trigger--mobile"
        type="button"
        :aria-label="`Open citation ${number}: ${source.title}`"
      >
        <sup>{{ number }}</sup>
      </button>
    </DrawerTrigger>
    <DrawerPortal>
      <DrawerOverlay class="campaign-citation-drawer-overlay" />
      <DrawerContent class="campaign-citation-drawer" @close-auto-focus="onDrawerCloseAutoFocus">
        <DrawerHandle class="campaign-citation-drawer-handle" />
        <div class="campaign-citation-drawer-content">
          <p class="campaign-citation-label">SOURCE {{ number }}</p>
          <DrawerTitle class="campaign-citation-title">{{ source.title }}</DrawerTitle>
          <DrawerDescription class="campaign-citation-meta">{{ sourceMetadata }}</DrawerDescription>
          <p v-if="source.note" class="campaign-citation-note">{{ source.note }}</p>
          <div class="campaign-citation-drawer-actions">
            <a class="campaign-citation-source-link" :href="source.url" target="_blank" rel="noreferrer">
              View source
            </a>
            <button class="campaign-citation-note-link" type="button" @click="readFullNote">Read the full note</button>
          </div>
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>

<style>
@layer components {
  .campaign-citation-trigger {
    display: inline-grid;
    place-items: center;
    min-inline-size: 1.35rem;
    min-block-size: 1.35rem;
    border: 0;
    border-radius: var(--radius-1);
    padding: 0 0.2rem;
    margin-inline: 0.08rem;
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
    font: inherit;
    font-weight: var(--font-weight-strong);
    line-height: 1;
    text-decoration: none;
    vertical-align: super;
    cursor: pointer;
  }

  .campaign-citation-trigger sup {
    font-size: 0.72em;
    line-height: 1;
  }

  .campaign-citation-trigger:hover,
  .campaign-citation-trigger:focus-visible,
  .campaign-citation-trigger[data-state='open'] {
    --anchor-color: var(--color-action-contrast);

    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .campaign-citation-trigger:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .campaign-citation-trigger--mobile {
    display: none;
  }

  .campaign-citation-card {
    z-index: 60;
    display: grid;
    gap: var(--space-3);
    inline-size: min(24rem, var(--reka-hover-card-content-available-width));
    border: var(--border-width) solid var(--color-border);
    border-block-start: var(--border-width-accent) solid var(--color-brand-highlight);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
    transform-origin: var(--reka-hover-card-content-transform-origin);
  }

  .campaign-citation-card[data-state='open'] {
    animation: campaign-citation-in 140ms ease-out;
  }

  .campaign-citation-card-arrow {
    fill: var(--color-surface);
    stroke: var(--color-border);
  }

  .campaign-citation-label,
  .campaign-citation-title,
  .campaign-citation-meta,
  .campaign-citation-note {
    margin: 0;
  }

  .campaign-citation-label {
    color: var(--color-accent-action);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.75rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
  }

  .campaign-citation-title {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.25rem;
    font-weight: 650;
    line-height: 1.15;
    text-wrap: balance;
  }

  .campaign-citation-meta {
    color: var(--color-text-muted);
    font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    text-transform: uppercase;
  }

  .campaign-citation-note {
    border-block-start: var(--border-width) solid var(--color-border);
    padding-block-start: var(--space-3);
    color: var(--color-text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .campaign-citation-card .campaign-citation-source-link,
  .campaign-citation-drawer .campaign-citation-source-link,
  .campaign-citation-drawer .campaign-citation-note-link {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-block-size: 2.75rem;
    border: var(--border-width) solid var(--color-brand-primary);
    border-radius: var(--radius-1);
    padding-inline: var(--space-4);

    --anchor-color: var(--color-action-contrast);

    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
    font-weight: var(--font-weight-strong);
    text-decoration: none;
  }

  .campaign-citation-drawer .campaign-citation-note-link {
    --anchor-color: var(--color-brand-primary);

    color: var(--color-brand-primary);
    background: transparent;
  }

  .campaign-citation-card .campaign-citation-source-link:hover,
  .campaign-citation-card .campaign-citation-source-link:focus-visible,
  .campaign-citation-drawer .campaign-citation-source-link:hover,
  .campaign-citation-drawer .campaign-citation-source-link:focus-visible,
  .campaign-citation-drawer .campaign-citation-note-link:hover,
  .campaign-citation-drawer .campaign-citation-note-link:focus-visible {
    --anchor-color: var(--color-brand-primary);

    color: var(--color-brand-primary);
    background: var(--color-brand-highlight);
  }

  .campaign-citation-drawer-overlay {
    position: fixed;
    z-index: 70;
    inset: 0;
    background: rgb(4 51 79 / 58%);
  }

  .campaign-citation-drawer {
    --citation-drawer-bleed: 3rem;

    position: fixed;
    z-index: 71;
    inset-inline: 0;
    inset-block-end: 0;
    max-block-size: min(82dvh, 42rem);
    overflow-y: auto;
    border-start-start-radius: var(--radius-2);
    border-start-end-radius: var(--radius-2);
    padding-block-end: calc(env(safe-area-inset-bottom, 0px) + var(--citation-drawer-bleed));
    margin-block-end: calc(-1 * var(--citation-drawer-bleed));
    color: var(--color-text);
    background: var(--color-surface);
    transform: translateY(var(--drawer-swipe-movement-y, 0));
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-citation-drawer[data-state='open'] {
    animation: campaign-drawer-in 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-citation-drawer[data-state='closed'] {
    animation: campaign-drawer-out 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .campaign-citation-drawer[data-swiping] {
    transition-duration: 0s;
  }

  .campaign-citation-drawer-handle {
    inline-size: 3rem;
    block-size: 0.3rem;
    border-radius: 999px;
    margin: var(--space-3) auto 0;
    background: var(--color-border);
  }

  .campaign-citation-drawer-content {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5) var(--content-gutter) var(--space-6);
  }

  .campaign-citation-drawer-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  @keyframes campaign-citation-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  @keyframes campaign-drawer-in {
    from {
      translate: 0 calc(100% - var(--citation-drawer-bleed));
    }
  }

  @keyframes campaign-drawer-out {
    to {
      translate: 0 calc(100% - var(--citation-drawer-bleed));
    }
  }

  @media (width <= 56rem) {
    .campaign-citation-trigger--desktop {
      display: none;
    }

    .campaign-citation-trigger--mobile {
      display: inline-grid;
      min-inline-size: 2rem;
      min-block-size: 2rem;
    }
  }

  @media (width <= 30rem) {
    .campaign-citation-drawer-actions {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .campaign-citation-card,
    .campaign-citation-drawer {
      animation-duration: 1ms;
      transition-duration: 1ms;
    }
  }
}
</style>
