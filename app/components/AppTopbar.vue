<script setup lang="ts">
import { projectAppSession } from '~/composables/useAppSession'
import { authClient } from '~/lib/auth-client'

const route = useRoute()
const { t } = useI18n()
const responseCacheControl = useResponseHeader('cache-control')
const clientSession = import.meta.client ? authClient.useSession() : null
const { data: session, error: sessionError } = await useAppSession()

if (import.meta.server && session.value?.user) {
  responseCacheControl.value = 'private, no-store'
}

if (clientSession) {
  watch(
    clientSession,
    (state) => {
      if (state.isPending || state.isRefetching || state.error) return

      const currentUserId = session.value?.user.id ?? null
      const nextSession = projectAppSession(state.data)
      const identityChanged = Boolean(currentUserId && currentUserId !== (nextSession?.user.id ?? null))

      session.value = nextSession
      sessionError.value = undefined
      if (identityChanged) reloadNuxtApp()
    },
    { immediate: true }
  )
}

function signedOut() {
  session.value = null
}

function currentPage(path: string, includeChildren = false) {
  return route.path === path || (includeChildren && route.path.startsWith(`${path}/`)) ? 'page' : undefined
}
</script>

<template>
  <header class="topbar" :aria-label="t('navigation.applicationLabel')">
    <NuxtLink
      class="brand"
      to="/"
      :aria-current="currentPage('/')"
      :aria-label="t('navigation.brandHome', { appName: $config.public.appName })"
    >
      <img src="/icon.svg" alt="" class="brand-mark" />
      <span>{{ $config.public.appName }}</span>
    </NuxtLink>
    <nav class="topbar-nav" :aria-label="t('navigation.primaryLabel')">
      <NuxtLink to="/app" :aria-current="currentPage('/app')">{{ t('navigation.app') }}</NuxtLink>
      <NuxtLink v-if="session?.user" to="/app/projects" :aria-current="currentPage('/app/projects', true)">
        {{ t('navigation.projects') }}
      </NuxtLink>
      <template v-if="!session?.user">
        <NuxtLink to="/login" :aria-current="currentPage('/login')">{{ t('navigation.login') }}</NuxtLink>
        <NuxtLink to="/signup" :aria-current="currentPage('/signup')">{{ t('navigation.signup') }}</NuxtLink>
      </template>
      <AccountMenu v-else :user="session.user" @signed-out="signedOut" />
    </nav>
  </header>
</template>

<style scoped>
@layer components {
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 64px;
    padding: var(--space-3) 0 var(--space-5);
  }

  .brand {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
  }

  .brand span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand-mark {
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
  }

  .topbar-nav {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .topbar-nav a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-2);
    padding: 7px 10px;
    color: var(--color-text-muted);
    font-weight: var(--font-weight-strong);
    text-decoration: none;
  }

  .topbar-nav a:hover,
  .topbar-nav a:focus-visible {
    border-color: var(--color-border);
    color: var(--color-text);
    background: var(--color-surface-subtle);
  }

  .topbar-nav a[aria-current='page'],
  .brand[aria-current='page'] {
    border-color: var(--color-action);
    color: var(--color-action);
    background: var(--color-action-soft);
  }

  @media (width <= 620px) {
    .topbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .topbar-nav {
      width: 100%;
      justify-content: flex-start;
    }
  }
}
</style>
