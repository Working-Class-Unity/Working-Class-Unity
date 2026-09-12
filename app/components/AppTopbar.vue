<script setup lang="ts">
import { unlocalizedPublicPath } from '#shared/public-site'
import {
  ConfigProvider,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuRoot,
  NavigationMenuTrigger
} from 'reka-ui'
import { duesPortalUrl } from '#shared/membership-links'
import { currentWorkNavigation } from '~/content/navigation'

const route = useRoute()
const publicPath = computed(() => unlocalizedPublicPath(route.path))
const { t } = useI18n()
const usesWideSurface = useWideSurfaceRoute()
const mobileMenuOpen = ref(false)
const desktopMenuValue = ref('')
const mobileMenuToggle = ref<HTMLButtonElement | null>(null)
const workGroups = computed(() =>
  currentWorkNavigation.map((group) => ({
    label: t(group.label),
    links: group.links.map((link) => ({
      path: link.path,
      label: t(link.label),
      description: t(link.description)
    }))
  }))
)
const mobileWorkOpen = ref(publicPath.value.startsWith('/campaigns/'))
const mobileEventsOpen = ref(false)
const {
  entries: upcomingEvents,
  status: eventsStatus,
  error: eventsError,
  refresh: refreshEvents
} = useUpcomingNavigationEvents()
watch(
  () => desktopMenuValue.value === 'events' || (mobileMenuOpen.value && mobileEventsOpen.value),
  (open) => {
    if (open && eventsStatus.value !== 'pending') void refreshEvents()
  }
)
const nuxtUseId = () => useId()
watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false
    desktopMenuValue.value = ''
    mobileWorkOpen.value = publicPath.value.startsWith('/campaigns/')
  },
  { flush: 'sync' }
)

function onNavigationClick(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return
  desktopMenuValue.value = ''
  void closeMobileMenu()
}

function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

async function closeMobileMenu() {
  if (!mobileMenuOpen.value) return

  mobileMenuOpen.value = false
  await nextTick()
  mobileMenuToggle.value?.focus()
}

function currentPage(path: string) {
  return publicPath.value === path ? 'page' : undefined
}

function currentWorkLocation() {
  return publicPath.value === '/' && route.hash === '#current-work' ? 'location' : undefined
}

function currentParticipationLocation() {
  return publicPath.value === '/' && route.hash === '#get-involved' ? 'location' : undefined
}
</script>

<template>
  <header class="topbar" :class="{ 'topbar--wide': usesWideSurface }" :aria-label="t('navigation.applicationLabel')">
    <div class="topbar-row">
      <div class="topbar-brand-area">
        <NuxtLinkLocale
          class="brand"
          to="/"
          :aria-current="currentPage('/')"
          :aria-label="t('navigation.brandHome', { appName: $config.public.appName })"
        >
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <img src="/images/wcu-logo-dark.png" alt="" class="brand-mark" width="2000" height="2000" />
        </NuxtLinkLocale>
      </div>

      <button
        ref="mobileMenuToggle"
        class="mobile-menu-toggle"
        type="button"
        aria-controls="primary-navigation-panel"
        :aria-expanded="mobileMenuOpen"
        @click="toggleMobileMenu"
      >
        {{ t('navigation.menu') }}
      </button>

      <div
        id="primary-navigation-panel"
        class="topbar-panel"
        :class="{ 'topbar-panel--open': mobileMenuOpen }"
        @keydown.esc="closeMobileMenu"
        @click="onNavigationClick"
      >
        <ConfigProvider :use-id="nuxtUseId">
          <NavigationMenuRoot
            v-model="desktopMenuValue"
            class="desktop-navigation"
            :aria-label="t('navigation.primaryLabel')"
          >
            <NavigationMenuList class="desktop-navigation-list">
              <NavigationMenuItem>
                <NavigationMenuLink as-child :active="publicPath === '/about'">
                  <NuxtLinkLocale class="topbar-link topbar-link--public" to="/about">
                    {{ t('navigation.about') }}
                  </NuxtLinkLocale>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem value="current-work" class="topbar-work-item">
                <NavigationMenuTrigger as-child>
                  <button
                    type="button"
                    class="topbar-link topbar-link--public topbar-work-trigger"
                    :data-active="currentWorkLocation() || publicPath.startsWith('/campaigns/') ? '' : undefined"
                  >
                    {{ t('navigation.currentWork') }}
                  </button>
                </NavigationMenuTrigger>
                <NavigationMenuContent class="topbar-work-menu">
                  <div class="topbar-work-groups">
                    <ContextNavigation
                      v-for="group in workGroups"
                      :key="group.label"
                      :label="group.label"
                      :links="group.links"
                      :current-path="publicPath"
                    >
                      <template #entry="{ entry }">
                        <NavigationMenuLink as-child :active="publicPath === entry.path">
                          <NavigationEntry :entry="entry" :current="publicPath === entry.path" />
                        </NavigationMenuLink>
                      </template>
                    </ContextNavigation>
                  </div>
                  <NavigationMenuLink as-child :active="Boolean(currentWorkLocation())">
                    <NuxtLinkLocale
                      class="topbar-link topbar-panel-footer"
                      to="/#current-work"
                      :aria-current="currentWorkLocation()"
                    >
                      {{ t('navigation.allCurrentWork') }}
                    </NuxtLinkLocale>
                  </NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
              <NavigationMenuItem value="events" class="topbar-work-item">
                <NavigationMenuTrigger as-child>
                  <button
                    type="button"
                    class="topbar-link topbar-link--public topbar-work-trigger"
                    :data-active="publicPath === '/calendar' ? '' : undefined"
                  >
                    {{ t('navigation.calendar') }}
                  </button>
                </NavigationMenuTrigger>
                <NavigationMenuContent class="topbar-work-menu topbar-events-menu">
                  <p class="topbar-panel-label">{{ t('navigation.upcomingEvents') }}</p>
                  <p v-if="eventsStatus === 'pending'" class="topbar-event-state" role="status">
                    {{ t('calendar.loading') }}
                  </p>
                  <div v-else-if="eventsError" class="topbar-event-state">
                    <p>{{ t('calendar.loadError') }}</p>
                    <AppButton variant="secondary" size="compact" @click="refreshEvents()">{{
                      t('common.retry')
                    }}</AppButton>
                  </div>
                  <p v-else-if="upcomingEvents.length === 0" class="topbar-event-state">{{ t('calendar.empty') }}</p>
                  <ul v-else class="topbar-event-list" role="list">
                    <li v-for="entry in upcomingEvents" :key="entry.id">
                      <NavigationMenuLink as-child>
                        <NavigationEntry :entry="entry" />
                      </NavigationMenuLink>
                    </li>
                  </ul>
                  <NavigationMenuLink as-child :active="publicPath === '/calendar'">
                    <NuxtLinkLocale
                      class="topbar-link topbar-panel-footer"
                      to="/calendar"
                      :aria-current="currentPage('/calendar')"
                    >
                      {{ t('navigation.allEvents') }}
                    </NuxtLinkLocale>
                  </NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenuRoot>
        </ConfigProvider>

        <nav class="mobile-navigation" :aria-label="t('navigation.primaryLabel')">
          <ul class="mobile-navigation-list" role="list">
            <li>
              <NuxtLinkLocale class="topbar-link topbar-link--public" to="/about" :aria-current="currentPage('/about')">
                {{ t('navigation.about') }}
              </NuxtLinkLocale>
            </li>
            <li>
              <button
                class="topbar-link topbar-link--public topbar-work-trigger"
                type="button"
                :aria-expanded="mobileWorkOpen"
                aria-controls="mobile-current-work"
                @click="mobileWorkOpen = !mobileWorkOpen"
              >
                {{ t('navigation.currentWork') }}
              </button>
              <div v-show="mobileWorkOpen" id="mobile-current-work" class="mobile-work-groups">
                <ContextNavigation
                  v-for="group in workGroups"
                  :key="group.label"
                  :label="group.label"
                  :links="group.links"
                  :current-path="publicPath"
                />
                <NuxtLinkLocale
                  class="topbar-link topbar-panel-footer"
                  to="/#current-work"
                  :aria-current="currentWorkLocation()"
                >
                  {{ t('navigation.allCurrentWork') }}
                </NuxtLinkLocale>
              </div>
            </li>
            <li>
              <button
                class="topbar-link topbar-link--public topbar-work-trigger"
                type="button"
                :aria-expanded="mobileEventsOpen"
                aria-controls="mobile-upcoming-events"
                @click="mobileEventsOpen = !mobileEventsOpen"
              >
                {{ t('navigation.calendar') }}
              </button>
              <div v-show="mobileEventsOpen" id="mobile-upcoming-events">
                <p class="topbar-panel-label">{{ t('navigation.upcomingEvents') }}</p>
                <p v-if="eventsStatus === 'pending'" class="topbar-event-state" role="status">
                  {{ t('calendar.loading') }}
                </p>
                <div v-else-if="eventsError" class="topbar-event-state">
                  <p>{{ t('calendar.loadError') }}</p>
                  <AppButton variant="secondary" size="compact" @click="refreshEvents()">{{
                    t('common.retry')
                  }}</AppButton>
                </div>
                <p v-else-if="upcomingEvents.length === 0" class="topbar-event-state">{{ t('calendar.empty') }}</p>
                <ul v-else class="topbar-event-list" role="list">
                  <li v-for="entry in upcomingEvents" :key="entry.id"><NavigationEntry :entry="entry" /></li>
                </ul>
                <NuxtLinkLocale
                  class="topbar-link topbar-panel-footer"
                  to="/calendar"
                  :aria-current="currentPage('/calendar')"
                >
                  {{ t('navigation.allEvents') }}
                </NuxtLinkLocale>
              </div>
            </li>
          </ul>
        </nav>

        <div class="topbar-actions">
          <LanguageSelector />
          <a
            class="topbar-link topbar-link--utility"
            href="https://chat.workingclassunity.com/"
            target="_blank"
            rel="noopener noreferrer"
            @click="closeMobileMenu"
          >
            {{ t('navigation.forum') }}
            <span class="visually-hidden"> ({{ t('common.opensInNewTab') }})</span>
          </a>
          <a class="topbar-link topbar-link--utility" :href="duesPortalUrl" @click="closeMobileMenu">
            {{ t('join.manageDues') }}
          </a>
        </div>
      </div>

      <NuxtLinkLocale
        class="topbar-link topbar-link--involved"
        to="/#get-involved"
        :aria-current="currentParticipationLocation()"
        @click="closeMobileMenu"
      >
        {{ t('navigation.getInvolved') }}
      </NuxtLinkLocale>
    </div>
  </header>
</template>

<style scoped>
@layer components {
  .topbar {
    position: relative;
    border-block-end: var(--border-width) solid rgb(4 51 79 / 12%);
    background: var(--color-surface);
  }

  .topbar-row {
    display: grid;
    grid-template-columns: 12.125rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 1.25rem;
    inline-size: min(var(--content-max-width), calc(100% - (2 * var(--content-gutter))));
    min-block-size: 6.5rem;
    min-width: 0;
    margin-inline: auto;
  }

  .topbar-brand-area,
  .topbar-actions {
    min-width: 0;
  }

  .brand {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    justify-content: flex-start;
    border-radius: var(--radius-1);
    padding: var(--space-1);
    text-decoration: none;
  }

  .brand-mark {
    display: block;
    inline-size: 3rem;
    block-size: auto;
    flex: 0 0 auto;
  }

  .topbar-panel {
    display: contents;
  }

  .desktop-navigation {
    position: relative;
    z-index: var(--z-menu);
    justify-self: start;
    min-width: 0;
    font-weight: var(--font-weight-strong);
  }

  :deep(.desktop-navigation-list),
  .topbar-actions {
    display: flex;
    align-items: center;
  }

  :deep(.desktop-navigation-list) {
    gap: 0.375rem;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .topbar-actions {
    justify-content: flex-end;
    gap: 0.25rem;
  }

  .mobile-navigation,
  .mobile-menu-toggle {
    display: none;
  }

  .topbar-link {
    --color-action: var(--color-brand-primary);

    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    max-inline-size: 100%;
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-1);
    padding: var(--space-2) var(--space-3);
    color: var(--color-brand-primary);
    font-size: 0.9375rem;
    font-weight: var(--font-weight-strong);
    line-height: 1.15;
    text-align: center;
    text-decoration: none;
  }

  .topbar-link--public {
    border-radius: 0;
    border-block-end-width: 2px;
  }

  .topbar-link--public:hover,
  .topbar-link--public:focus-visible {
    border-block-end-color: var(--color-border);
  }

  .topbar-link--public[data-active],
  .topbar-link--public[aria-current] {
    border-block-end-color: var(--color-brand-primary);
  }

  :deep(.topbar-work-item) {
    position: relative;
  }

  .topbar-work-trigger {
    gap: var(--space-2);
    background: transparent;
    font-family: inherit;
  }

  .topbar-work-trigger::after {
    inline-size: 0.375rem;
    block-size: 0.375rem;
    flex: 0 0 auto;
    border-inline-end: 2px solid currentcolor;
    border-block-end: 2px solid currentcolor;
    content: '';
    transform: rotate(45deg);
  }

  .topbar-work-trigger[data-state='open']::after,
  .topbar-work-trigger[aria-expanded='true']::after {
    transform: rotate(225deg);
  }

  :deep(.topbar-work-menu) {
    position: absolute;
    inset-block-start: 100%;
    inset-inline-start: 0;
    inline-size: min(46rem, calc(100vw - 4rem));
    border: var(--border-width) solid rgb(4 51 79 / 12%);
    border-radius: var(--radius-1);
    padding: var(--space-2);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
  }

  .topbar-event-list {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  :deep(.topbar-events-menu) {
    inline-size: min(28rem, calc(100vw - 4rem));
  }

  .topbar-work-groups,
  .mobile-work-groups {
    display: grid;
    gap: var(--space-4);
  }

  .topbar-panel-label {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-muted);
    font-size: 1rem;
    line-height: 1.5;
  }

  .topbar-event-state {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3);
    font-size: 1rem;
    line-height: 1.5;
  }

  .topbar-event-state p {
    margin: 0;
  }

  .topbar-panel-footer {
    inline-size: 100%;
    justify-content: flex-start;
    border-block-start-color: var(--color-border);
    margin-block-start: var(--space-3);
    text-align: start;
  }

  .topbar-link--utility {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .topbar-link--utility:hover,
  .topbar-link--utility:focus-visible {
    color: var(--color-brand-primary);
    background: var(--color-action-soft);
  }

  .topbar-link--involved {
    border-color: var(--color-brand-primary);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
  }

  .topbar-link--involved:hover,
  .topbar-link--involved:focus-visible {
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .topbar .topbar-actions :deep(.account-menu-trigger) {
    min-block-size: var(--control-min-block-size);
    border: var(--border-width) solid var(--color-brand-primary);
    border-radius: var(--radius-1);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
  }

  .topbar .topbar-actions :deep(.account-menu-trigger:hover),
  .topbar .topbar-actions :deep(.account-menu-trigger:focus-visible),
  .topbar .topbar-actions :deep(.account-menu-trigger[data-state='open']) {
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  @media (width <= 77rem) {
    .topbar-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0 0.625rem;
      inline-size: min(var(--content-max-width), calc(100% - 3rem));
      min-block-size: 4.5rem;
    }

    .topbar-brand-area {
      flex: 1 1 auto;
    }

    .brand-mark {
      inline-size: 2.375rem;
    }

    .mobile-menu-toggle {
      flex: 0 0 auto;
      display: inline-flex;
      min-block-size: var(--control-min-block-size);
      min-inline-size: var(--control-min-inline-size);
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: var(--radius-1);
      padding: var(--space-2);
      color: var(--color-brand-primary);
      background: transparent;
      font: inherit;
      font-weight: var(--font-weight-strong);
    }

    .mobile-menu-toggle:hover,
    .mobile-menu-toggle:focus-visible,
    .mobile-menu-toggle[aria-expanded='true'] {
      color: var(--color-brand-primary);
      background: var(--color-action-soft);
    }

    .topbar-row > .topbar-link--involved {
      order: 3;
      flex: 0 1 auto;
      inline-size: auto;
      min-block-size: 2.75rem;
      min-inline-size: auto;
      justify-content: center;
      padding-inline: var(--space-3);
      min-width: 0;
      font-size: 0.875rem;
      text-align: center;
      overflow-wrap: anywhere;
    }

    .topbar-panel {
      order: 4;
      flex-basis: 100%;
      min-inline-size: 0;
      display: none;
      gap: var(--space-4);
      border-block-start: var(--border-width) solid var(--color-border);
      padding-block: var(--space-3) var(--space-5);
      background: var(--color-surface);
    }

    .topbar-panel--open {
      display: grid;
    }

    .desktop-navigation {
      display: none;
    }

    .mobile-navigation {
      display: block;
    }

    .mobile-navigation-list {
      display: grid;
      padding: 0;
      margin: 0;
      list-style: none;
    }

    .mobile-navigation-list > li {
      border-block-end: var(--border-width) solid var(--color-border);
    }

    .topbar-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
      gap: var(--space-2);
    }

    .topbar-link,
    .topbar .topbar-actions :deep(.account-menu-trigger) {
      inline-size: 100%;
      justify-content: flex-start;
      font-size: 1rem;
      text-align: start;
    }

    .topbar-link--public {
      justify-content: space-between;
      border-block-end: 0;
      padding-block: var(--space-3);
    }

    .topbar-link--public[aria-current] {
      border-inline-start: var(--border-width-accent) solid var(--color-brand-primary);
    }
  }
}
</style>
