<script setup lang="ts">
import { ConfigProvider, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuRoot } from 'reka-ui'
import { toAppSession } from '~/composables/useAppSession'
import { authClient } from '~/lib/auth-client'

const route = useRoute()
const { t } = useI18n()
const usesWideSurface = useWideSurfaceRoute()
const responseCacheControl = useResponseHeader('cache-control')
const clientSession = import.meta.client ? authClient.useSession() : null
const { data: session, error: sessionError, status: sessionStatus, refresh: refreshSession } = await useAppSession()
const retryState = ref<'idle' | 'pending' | 'failed'>('idle')
const mobileMenuOpen = ref(false)
const mobileMenuToggle = ref<HTMLButtonElement | null>(null)
const retrying = computed(() => retryState.value === 'pending')
const nuxtUseId = () => useId()
const retryAnnouncement = computed<'polite' | 'assertive' | undefined>(() => {
  if (retryState.value === 'pending') return 'polite'
  if (retryState.value === 'failed') return 'assertive'
  return undefined
})

if (import.meta.server && session.value?.user) {
  responseCacheControl.value = 'private, no-store'
}

if (clientSession) {
  watch(
    clientSession,
    (state) => {
      if (state.isPending || state.isRefetching || state.error) return

      const currentUserId = session.value?.user.id ?? null
      const nextSession = toAppSession(state.data)
      const identityChanged = Boolean(currentUserId && currentUserId !== (nextSession?.user.id ?? null))

      session.value = nextSession
      sessionError.value = undefined
      if (identityChanged) reloadNuxtApp()
    },
    { immediate: true }
  )
}

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false
  },
  { flush: 'sync' }
)

function signedOut() {
  session.value = null
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

async function retrySession() {
  if (retrying.value) return

  retryState.value = 'pending'
  try {
    await refreshSession()
  } catch {
    retryState.value = 'failed'
    return
  }
  retryState.value = sessionError.value ? 'failed' : 'idle'
}

function currentPage(path: string) {
  return route.path === path ? 'page' : undefined
}

function currentWorkLocation() {
  return route.path === '/' && route.hash === '#current-work' ? 'location' : undefined
}

function currentParticipationLocation() {
  return route.path === '/' && route.hash === '#get-involved' ? 'location' : undefined
}
</script>

<template>
  <header class="topbar" :class="{ 'topbar--wide': usesWideSurface }" :aria-label="t('navigation.applicationLabel')">
    <div class="topbar-row">
      <div class="topbar-brand-area">
        <NuxtLink
          class="brand"
          to="/"
          :aria-current="currentPage('/')"
          :aria-label="t('navigation.brandHome', { appName: $config.public.appName })"
        >
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <img src="/images/wcu-logo-dark.png" alt="" class="brand-mark" width="2000" height="2000" />
        </NuxtLink>
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
        @keydown.esc.prevent.stop="closeMobileMenu"
      >
        <ConfigProvider :use-id="nuxtUseId">
          <NavigationMenuRoot class="desktop-navigation" :aria-label="t('navigation.primaryLabel')">
            <NavigationMenuList class="desktop-navigation-list">
              <NavigationMenuItem>
                <NavigationMenuLink as-child :active="route.path === '/about'">
                  <NuxtLink class="topbar-link topbar-link--public" to="/about">
                    {{ t('navigation.about') }}
                  </NuxtLink>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink as-child :active="Boolean(currentWorkLocation())">
                  <NuxtLink
                    class="topbar-link topbar-link--public"
                    to="/#current-work"
                    :aria-current="currentWorkLocation()"
                  >
                    {{ t('navigation.currentWork') }}
                  </NuxtLink>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink as-child :active="route.path === '/calendar'">
                  <NuxtLink class="topbar-link topbar-link--public" to="/calendar">
                    {{ t('navigation.calendar') }}
                  </NuxtLink>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenuRoot>
        </ConfigProvider>

        <nav class="mobile-navigation" :aria-label="t('navigation.primaryLabel')">
          <ul class="mobile-navigation-list" role="list">
            <li>
              <NuxtLink class="topbar-link topbar-link--public" to="/about" :aria-current="currentPage('/about')">
                {{ t('navigation.about') }}
              </NuxtLink>
            </li>
            <li>
              <NuxtLink
                class="topbar-link topbar-link--public"
                to="/#current-work"
                :aria-current="currentWorkLocation()"
                @click="closeMobileMenu"
              >
                {{ t('navigation.currentWork') }}
              </NuxtLink>
            </li>
            <li>
              <NuxtLink class="topbar-link topbar-link--public" to="/calendar" :aria-current="currentPage('/calendar')">
                {{ t('navigation.calendar') }}
              </NuxtLink>
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
          <AppNotice
            v-if="sessionError"
            class="topbar-session"
            :tone="retrying ? 'info' : 'error'"
            :announce="retryAnnouncement"
            :title="retrying ? t('common.checkingSession') : t('navigation.sessionUnavailable')"
          >
            <AppButton
              variant="secondary"
              size="compact"
              :aria-busy="retrying ? 'true' : undefined"
              :aria-disabled="retrying ? 'true' : undefined"
              @click="retrySession"
            >
              {{ retrying ? t('common.checkingSession') : t('common.retry') }}
            </AppButton>
          </AppNotice>
          <AppNotice v-else-if="sessionStatus === 'pending'" class="topbar-session" tone="info">
            {{ t('common.checkingSession') }}
          </AppNotice>
          <template v-else-if="!session?.user">
            <NuxtLink class="topbar-link topbar-link--login" to="/login" :aria-current="currentPage('/login')">
              {{ t('navigation.login') }}
            </NuxtLink>
          </template>
          <template v-else>
            <NuxtLink class="topbar-link topbar-link--app" to="/app" :aria-current="currentPage('/app')">
              {{ t('navigation.app') }}
            </NuxtLink>
            <AccountMenu :user="session.user" @signed-out="signedOut" />
          </template>
        </div>
      </div>

      <NuxtLink
        class="topbar-link topbar-link--involved"
        to="/#get-involved"
        :aria-current="currentParticipationLocation()"
        @click="closeMobileMenu"
      >
        {{ t('navigation.getInvolved') }}
      </NuxtLink>
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
    justify-self: start;
    min-width: 0;
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

  .topbar-session {
    max-inline-size: 22rem;
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

  .topbar-link--utility,
  .topbar-link--login,
  .topbar-link--app {
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }

  .topbar-link--utility:hover,
  .topbar-link--utility:focus-visible,
  .topbar-link--login:hover,
  .topbar-link--login:focus-visible,
  .topbar-link--login[aria-current='page'],
  .topbar-link--app:hover,
  .topbar-link--app:focus-visible,
  .topbar-link--app[aria-current='page'] {
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
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 0 0.625rem;
      inline-size: min(var(--content-max-width), calc(100% - 3rem));
      min-block-size: 4.5rem;
    }

    .topbar-brand-area {
      grid-area: 1 / 1;
    }

    .brand-mark {
      inline-size: 2.375rem;
    }

    .mobile-menu-toggle {
      grid-area: 1 / 2;
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
      grid-area: 1 / 3;
      min-block-size: 2.75rem;
      min-inline-size: auto;
      justify-content: center;
      padding-inline: var(--space-3);
      font-size: 0.875rem;
      text-align: center;
    }

    .topbar-panel {
      grid-column: 1 / 4;
      grid-row: 2;
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

    .mobile-navigation-list li {
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
      border-block-end: 0;
      padding-block: var(--space-3);
    }

    .topbar-link--public[aria-current] {
      border-inline-start: var(--border-width-accent) solid var(--color-brand-primary);
    }

    .topbar-session {
      max-inline-size: none;
      inline-size: 100%;
    }
  }
}
</style>
