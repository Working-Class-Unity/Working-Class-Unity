<script setup lang="ts">
import type { PublicModuleStates } from '#shared/modules'

type PersonalAppView = {
  user: {
    id: string
    name: string
    email: string
    image?: string | null
  }
  modules: PublicModuleStates
}

const { t } = useI18n()
const { data: session, error: sessionError } = await useAppSession()
const sessionUserId = computed(() => session.value?.user.id ?? null)

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const {
  data: appView,
  error: appViewError,
  status: appViewStatus,
  refresh,
  clear: clearAppViewRequest
} = await useFetch<PersonalAppView>('/api/me', {
  enabled: () => Boolean(sessionUserId.value),
  watch: false
})

watch(sessionUserId, async (userId, previousUserId) => {
  if (userId === previousUserId) return

  clearAppViewRequest()
  if (userId) await refresh()
})

const isLoading = computed(() => Boolean(session.value?.user) && appViewStatus.value === 'pending')
const isUnavailable = computed(() => Boolean(sessionError.value || appViewError.value))
const authorizedAppView = computed(() => {
  if (!session.value?.user || session.value.user.id !== appView.value?.user.id) return null
  return appView.value
})

useHead(() => ({
  title: t('metadata.app.title')
}))
</script>

<template>
  <AppPage class="personal-app-page">
    <section class="panel personal-app-panel" aria-labelledby="personal-app-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('personalApp.eyebrow') }}</p>
        <h1 id="personal-app-title">
          {{
            authorizedAppView?.user.name
              ? t('personalApp.welcomeNamed', { name: authorizedAppView.user.name })
              : t('personalApp.welcome')
          }}
        </h1>
      </div>

      <UiStateBlock
        v-if="isLoading"
        tone="loading"
        :title="t('personalApp.loading.title')"
        :description="t('personalApp.loading.description')"
      />

      <UiStateBlock
        v-else-if="isUnavailable"
        tone="error"
        :title="t('personalApp.unavailable.title')"
        :description="t('personalApp.unavailable.description')"
        :action-label="t('common.retry')"
        :busy="isLoading"
        @action="refresh()"
      />

      <div v-else-if="authorizedAppView" class="personal-app-content">
        <p>{{ t('personalApp.ready') }}</p>
        <i18n-t keypath="personalApp.signedInAs" tag="p" class="account-email">
          <template #email>
            <strong>{{ authorizedAppView.user.email }}</strong>
          </template>
        </i18n-t>
        <div class="personal-app-actions">
          <NuxtLink class="primary-button account-link" to="/app/projects">
            {{ t('personalApp.viewProjects') }}
          </NuxtLink>
          <NuxtLink class="secondary-button account-link" to="/account">
            {{ t('personalApp.manageAccount') }}
          </NuxtLink>
        </div>
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .personal-app-page {
    display: grid;
    place-items: start center;
    padding-block: var(--space-6);
  }

  .personal-app-panel {
    display: grid;
    gap: var(--space-4);
    width: min(100%, 760px);
  }

  .personal-app-content,
  .personal-app-actions {
    display: grid;
    gap: var(--space-3);
  }

  .personal-app-content p {
    margin: 0;
  }

  .account-email {
    color: var(--color-text-muted);
  }

  .personal-app-actions {
    grid-template-columns: repeat(2, minmax(0, max-content));
  }

  .account-link {
    width: fit-content;
    text-decoration: none;
  }

  @media (width <= 520px) {
    .personal-app-actions {
      grid-template-columns: 1fr;
    }

    .account-link {
      width: 100%;
    }
  }
}
</style>
