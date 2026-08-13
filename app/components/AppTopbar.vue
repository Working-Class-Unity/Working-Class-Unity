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

async function closeMobileMenuOnEscape() {
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

      <div
        id="primary-navigation-panel"
        class="topbar-panel"
        :class="{ 'topbar-panel--open': mobileMenuOpen }"
        @keydown.esc.prevent.stop="closeMobileMenuOnEscape"
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
                <NavigationMenuLink as-child :active="route.path === '/calendar'">
                  <NuxtLink class="topbar-link topbar-link--public" to="/calendar">
                    {{ t('navigation.calendar') }}
                  </NuxtLink>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink as-child :active="route.path === '/forum'">
                  <NuxtLink class="topbar-link topbar-link--public" to="/forum">
                    {{ t('navigation.forum') }}
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
              <NuxtLink class="topbar-link topbar-link--public" to="/calendar" :aria-current="currentPage('/calendar')">
                {{ t('navigation.calendar') }}
              </NuxtLink>
            </li>
            <li>
              <NuxtLink class="topbar-link topbar-link--public" to="/forum" :aria-current="currentPage('/forum')">
                {{ t('navigation.forum') }}
              </NuxtLink>
            </li>
          </ul>
        </nav>

        <div class="topbar-actions">
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
            <NuxtLink class="topbar-link topbar-link--join" to="/signup" :aria-current="currentPage('/signup')">
              {{ t('navigation.signup') }}
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
    </div>
  </header>
</template>

<style scoped>
@layer components {
  .topbar {
    position: relative;
    background: var(--color-canvas);
  }

  .topbar-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-5);
    min-block-size: 6.75rem;
    min-width: 0;
    padding-block: var(--space-2);
  }

  .topbar--wide .topbar-row {
    padding-inline: var(--home-content-inset);
  }

  .topbar-brand-area,
  .topbar-actions {
    min-width: 0;
  }

  .brand {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    min-width: 0;
    border-radius: var(--radius-2);
    padding: var(--space-1) var(--space-2);
    text-decoration: none;
  }

  .topbar--wide .brand {
    padding-inline: 0;
  }

  .brand-mark {
    display: block;
    inline-size: clamp(4.75rem, 6vw, 5.75rem);
    block-size: auto;
    flex: 0 0 auto;
  }

  .topbar-panel {
    display: contents;
  }

  .desktop-navigation {
    justify-self: center;
    min-width: 0;
  }

  :deep(.desktop-navigation-list),
  .topbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  :deep(.desktop-navigation-list) {
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .topbar-actions {
    justify-content: flex-end;
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
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-1);
    padding: var(--space-2) var(--space-3);
    color: var(--color-brand-primary);
    font-size: 0.95rem;
    font-weight: var(--font-weight-strong);
    line-height: 1;
    text-decoration: none;
  }

  .topbar-link--public:hover,
  .topbar-link--public:focus-visible,
  .topbar-link--public[data-active],
  .topbar-link--public[aria-current='page'] {
    color: var(--color-brand-primary);
    background: var(--color-surface-subtle);
  }

  .topbar-link--login,
  .topbar-link--app {
    min-block-size: 3rem;
    border-width: 2px;
    border-color: var(--color-brand-primary);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
  }

  .topbar-link--login:hover,
  .topbar-link--login:focus-visible,
  .topbar-link--login[aria-current='page'],
  .topbar-link--app:hover,
  .topbar-link--app:focus-visible,
  .topbar-link--app[aria-current='page'] {
    --color-action: var(--color-action-contrast);

    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .topbar-link--join {
    --color-action: var(--color-accent-action-contrast);

    min-block-size: 3rem;
    border-width: 2px;
    border-color: var(--color-accent-action);
    padding-inline: var(--space-4);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .topbar-link--join:hover,
  .topbar-link--join:focus-visible {
    --color-action: var(--color-action-contrast);

    border-color: var(--color-brand-primary);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  .topbar .topbar-actions :deep(.account-menu-trigger) {
    min-block-size: 3rem;
    border: 2px solid var(--color-brand-primary);
    border-radius: var(--radius-1);
    padding-inline: var(--space-4);
    color: var(--color-brand-primary);
    background: transparent;
  }

  .topbar .topbar-actions :deep(.account-menu-trigger:hover),
  .topbar .topbar-actions :deep(.account-menu-trigger:focus-visible),
  .topbar .topbar-actions :deep(.account-menu-trigger[data-state='open']) {
    border-color: var(--color-brand-primary);
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
  }

  @media (width <= 900px) {
    .topbar-row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0 var(--space-3);
      min-block-size: 5.75rem;
      padding-block: var(--space-2) 0;
    }

    .topbar--home .topbar-row {
      padding-inline: var(--space-4);
    }

    .topbar-brand-area {
      grid-area: 1 / 1;
    }

    .brand-mark {
      inline-size: 4.5rem;
    }

    .mobile-menu-toggle {
      grid-area: 1 / 2;
      display: inline-flex;
      min-block-size: var(--control-min-block-size);
      min-inline-size: var(--control-min-inline-size);
      align-items: center;
      justify-content: center;
      border: 2px solid var(--color-brand-primary);
      border-radius: var(--radius-1);
      padding: var(--space-2) var(--space-4);
      color: var(--color-brand-primary);
      background: transparent;
      font: inherit;
      font-weight: var(--font-weight-strong);
    }

    .mobile-menu-toggle:hover,
    .mobile-menu-toggle:focus-visible,
    .mobile-menu-toggle[aria-expanded='true'] {
      border-color: var(--color-brand-primary);
      color: var(--color-action-contrast);
      background: var(--color-brand-primary);
    }

    .topbar-panel {
      grid-column: 1 / -1;
      grid-row: 2;
      display: none;
      gap: var(--space-3);
      border-block-start: var(--border-width) solid var(--color-brand-primary);
      padding-block: var(--space-3) var(--space-4);
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
      gap: var(--space-1);
      padding: 0;
      margin: 0;
      list-style: none;
    }

    .topbar-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: stretch;
      gap: var(--space-2);
      border-block-start: var(--border-width) solid var(--color-border);
      padding-block-start: var(--space-3);
    }

    .topbar-link {
      inline-size: 100%;
      justify-content: flex-start;
      font-size: 1rem;
    }

    .topbar-actions .topbar-link {
      justify-content: center;
    }

    .topbar-session {
      grid-column: 1 / -1;
      max-inline-size: none;
      inline-size: 100%;
    }

    .topbar .topbar-actions :deep(.account-menu-trigger) {
      inline-size: 100%;
      justify-content: center;
    }
  }
}
</style>
