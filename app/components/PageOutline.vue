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

type PageOutlineItem = Readonly<{
  id: string
  label: string
  marker?: string
  children?: readonly PageOutlineItem[]
}>

const props = withDefaults(
  defineProps<{
    items: readonly PageOutlineItem[]
    label: string
    title: string
    description: string
    triggerLabel: string
    closeLabel: string
    triggerVariant?: 'primary' | 'secondary'
    showMarkers?: boolean
    showTriggerIndicator?: boolean
  }>(),
  {
    showMarkers: false,
    triggerVariant: 'secondary',
    showTriggerIndicator: false
  }
)

const hasNestedItems = computed(() => props.items.some((item) => item.children?.length))

function itemMarker(item: PageOutlineItem, index: number) {
  return item.marker ?? String(index + 1).padStart(2, '0')
}
</script>

<template>
  <div
    class="page-outline"
    :data-markers="showMarkers ? undefined : 'hidden'"
    :data-nested="hasNestedItems || undefined"
  >
    <aside class="page-outline-desktop">
      <p>{{ title }}</p>
      <nav :aria-label="label">
        <ol class="page-outline-list" role="list">
          <li v-for="(item, index) in items" :key="item.id">
            <a class="page-outline-link" :href="`#${item.id}`">
              <span v-if="showMarkers" aria-hidden="true">{{ itemMarker(item, index) }}</span>
              {{ item.label }}
            </a>
            <ol v-if="item.children?.length" class="page-outline-children" role="list">
              <li v-for="(child, childIndex) in item.children" :key="child.id">
                <a :href="`#${child.id}`">
                  <span v-if="showMarkers" aria-hidden="true">{{ itemMarker(child, childIndex) }}</span>
                  {{ child.label }}
                </a>
              </li>
            </ol>
          </li>
        </ol>
      </nav>
    </aside>

    <DrawerRoot>
      <DrawerTrigger as-child>
        <AppButton class="page-outline-trigger" :variant="triggerVariant" type="button">
          {{ triggerLabel }}
          <span v-if="showTriggerIndicator" class="page-outline-trigger-mark" aria-hidden="true" />
        </AppButton>
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerOverlay class="page-outline-overlay" />
        <DrawerContent
          class="page-outline-drawer"
          :data-markers="showMarkers ? undefined : 'hidden'"
          :data-nested="hasNestedItems || undefined"
        >
          <DrawerHandle class="page-outline-handle" />
          <div class="page-outline-content">
            <div class="page-outline-heading">
              <div>
                <DrawerTitle>{{ title }}</DrawerTitle>
                <DrawerDescription>{{ description }}</DrawerDescription>
              </div>
              <DrawerClose as-child>
                <AppButton
                  class="page-outline-close"
                  type="button"
                  variant="secondary"
                  size="compact"
                  :aria-label="closeLabel"
                >
                  <span class="page-outline-close-mark" aria-hidden="true" />
                </AppButton>
              </DrawerClose>
            </div>

            <nav :aria-label="label">
              <ol class="page-outline-drawer-list" role="list">
                <li v-for="(item, index) in items" :key="item.id">
                  <DrawerClose as-child>
                    <a class="page-outline-drawer-link" :href="`#${item.id}`">
                      <span v-if="showMarkers" aria-hidden="true">{{ itemMarker(item, index) }}</span>
                      {{ item.label }}
                    </a>
                  </DrawerClose>
                  <ol v-if="item.children?.length" class="page-outline-drawer-children" role="list">
                    <li v-for="(child, childIndex) in item.children" :key="child.id">
                      <DrawerClose as-child>
                        <a :href="`#${child.id}`">
                          <span v-if="showMarkers" aria-hidden="true">{{ itemMarker(child, childIndex) }}</span>
                          {{ child.label }}
                        </a>
                      </DrawerClose>
                    </li>
                  </ol>
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
/* stylelint-disable no-descending-specificity -- desktop and drawer link families share one structural contract. */
@layer components {
  .page-outline {
    min-width: 0;
  }

  .page-outline-desktop {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }

  .page-outline[data-nested] .page-outline-desktop {
    padding-inline-end: var(--space-3);
  }

  .page-outline-desktop > p {
    margin: 0;
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .page-outline-desktop nav {
    min-width: 0;
  }

  .page-outline-list,
  .page-outline-children,
  .page-outline-drawer-list,
  .page-outline-drawer-children {
    display: grid;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .page-outline-list {
    gap: var(--space-1);
  }

  .page-outline[data-nested] .page-outline-list {
    gap: var(--space-3);
  }

  .page-outline-link,
  .page-outline-children a {
    display: grid;
    gap: var(--space-2);
    border-radius: var(--radius-1);
    color: var(--color-text-muted);
    line-height: 1.4;
    text-decoration: none;
  }

  .page-outline-link {
    grid-template-columns: 1.75rem minmax(0, 1fr);
    min-block-size: var(--control-min-block-size);
    align-items: center;
    padding: var(--space-2);
    font-size: 0.875rem;
  }

  .page-outline[data-markers='hidden'] .page-outline-link,
  .page-outline[data-markers='hidden'] .page-outline-children a {
    grid-template-columns: minmax(0, 1fr);
  }

  .page-outline[data-nested] .page-outline-link {
    font-weight: var(--font-weight-strong);
  }

  .page-outline-children {
    gap: var(--space-1);
    border-inline-start: var(--border-width) solid var(--color-divider);
    padding-inline-start: var(--space-3);
    margin-inline-start: 1.35rem;
    margin-block-start: var(--space-1);
  }

  .page-outline-children a {
    grid-template-columns: 1.25rem minmax(0, 1fr);
    padding: var(--space-1) var(--space-2);
    font-size: 0.8125rem;
  }

  .page-outline-link > span,
  .page-outline-children a > span,
  .page-outline-drawer-link > span,
  .page-outline-drawer-children a > span {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-variant-numeric: tabular-nums;
  }

  .page-outline-link:hover,
  .page-outline-link:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .page-outline-children a:hover,
  .page-outline-children a:focus-visible {
    color: var(--color-accent-action);
    background: var(--color-action-soft);
  }

  .page-outline-trigger {
    position: fixed;
    z-index: calc(var(--z-menu) + 1);
    inset-inline-end: max(var(--space-4), env(safe-area-inset-right, 0px));
    inset-block-end: max(var(--space-4), env(safe-area-inset-bottom, 0px));
    display: none;
    gap: var(--space-2);
    border-radius: var(--radius-round);
    box-shadow: var(--shadow-panel);
    font-size: 1rem;
    font-weight: var(--font-weight-strong);
    cursor: pointer;
  }

  .page-outline-trigger[data-variant='secondary'] {
    --color-control-border: var(--color-brand-primary);
    --color-text: var(--color-brand-primary);
  }

  .page-outline-trigger:hover,
  .page-outline-trigger:focus-visible,
  .page-outline-trigger[data-state='open'] {
    border-color: var(--color-brand-primary);
    color: var(--color-brand-primary);
    background: var(--color-brand-highlight);
    filter: none;
  }

  .page-outline-trigger-mark {
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-block-end: 1.5px solid currentcolor;
    border-inline-end: 1.5px solid currentcolor;
    rotate: 45deg;
    translate: 0 -0.1rem;
  }

  .page-outline-trigger[data-state='open'] .page-outline-trigger-mark {
    rotate: 225deg;
    translate: 0 0.1rem;
  }

  .page-outline-overlay {
    position: fixed;
    z-index: 80;
    inset: 0;
    background: var(--color-overlay);
  }

  .page-outline-drawer {
    --outline-drawer-bleed: 3rem;

    position: fixed;
    z-index: 81;
    inset-inline: 0;
    inset-block-end: 0;
    max-block-size: min(82dvh, 42rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-start-start-radius: var(--radius-2);
    border-start-end-radius: var(--radius-2);
    padding-block-end: calc(env(safe-area-inset-bottom, 0px) + var(--outline-drawer-bleed));
    margin-block-end: calc(-1 * var(--outline-drawer-bleed));
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: 0 -1.25rem 3rem rgb(4 20 31 / 18%);
    transform: translateY(var(--drawer-swipe-movement-y, 0));
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .page-outline-drawer[data-nested] {
    max-block-size: min(86dvh, 44rem);
  }

  .page-outline-drawer[data-state='open'] {
    animation: page-outline-in 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .page-outline-drawer[data-state='closed'] {
    animation: page-outline-out 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .page-outline-drawer[data-swiping] {
    transition-duration: 0s;
  }

  .page-outline-handle {
    inline-size: 3rem;
    block-size: 0.3rem;
    border-radius: var(--radius-round);
    margin: var(--space-3) auto 0;
    background: var(--color-border);
  }

  .page-outline-content {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5) var(--content-gutter) var(--space-6);
  }

  .page-outline-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: start;
  }

  .page-outline-heading > div {
    display: grid;
    gap: var(--space-1);
  }

  .page-outline-heading h2,
  .page-outline-heading p {
    margin: 0;
  }

  .page-outline-heading h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: 1.5rem;
    font-weight: 650;
    letter-spacing: -0.03em;
  }

  .page-outline-heading p {
    color: var(--color-text-muted);
    font-size: 1rem;
  }

  .page-outline-close {
    inline-size: var(--control-min-inline-size);
    block-size: var(--control-min-block-size);
    border-color: var(--color-border);
    border-radius: var(--radius-1);
    padding: 0;
    color: var(--color-brand-primary);
    background: transparent;
  }

  .page-outline-close-mark {
    position: relative;
    display: block;
    inline-size: 1rem;
    block-size: 1rem;
  }

  .page-outline-close-mark::before,
  .page-outline-close-mark::after {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 0;
    inline-size: 1rem;
    block-size: 1.5px;
    content: '';
    background: currentcolor;
  }

  .page-outline-close-mark::before {
    rotate: 45deg;
  }

  .page-outline-close-mark::after {
    rotate: -45deg;
  }

  .page-outline-drawer-list {
    gap: var(--space-1);
  }

  .page-outline-drawer[data-nested] .page-outline-drawer-list {
    gap: var(--space-4);
  }

  .page-outline-drawer-link,
  .page-outline-drawer-children a {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    min-block-size: var(--control-min-block-size);
    color: var(--color-brand-primary);
    line-height: 1.4;
    text-decoration: none;
  }

  .page-outline-drawer-link {
    border-block-start: var(--border-width) solid var(--color-border);
    padding-block: var(--space-4);
    font-weight: var(--font-weight-strong);
  }

  .page-outline-drawer[data-markers='hidden'] .page-outline-drawer-link,
  .page-outline-drawer[data-markers='hidden'] .page-outline-drawer-children a {
    grid-template-columns: minmax(0, 1fr);
  }

  .page-outline-drawer-children {
    gap: var(--space-1);
    border-inline-start: var(--border-width) solid var(--color-divider);
    padding-inline-start: var(--space-4);
    margin-inline-start: var(--space-4);
  }

  .page-outline-drawer-children a {
    padding-block: var(--space-2);
    line-height: 1.5;
  }

  .page-outline-drawer-link:hover,
  .page-outline-drawer-link:focus-visible,
  .page-outline-drawer-children a:hover,
  .page-outline-drawer-children a:focus-visible {
    color: var(--color-accent-action);
    background: var(--color-action-soft);
  }

  @keyframes page-outline-in {
    from {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @keyframes page-outline-out {
    to {
      translate: 0 calc(100% - var(--outline-drawer-bleed));
    }
  }

  @media (width <= 56rem) {
    .page-outline {
      block-size: 0;
    }

    .page-outline-desktop {
      display: none;
    }

    .page-outline-trigger {
      display: inline-flex;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .page-outline-drawer {
      animation-duration: 1ms;
      transition-duration: 1ms;
    }
  }
}
/* stylelint-enable no-descending-specificity */
</style>
