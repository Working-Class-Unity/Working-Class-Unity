<script setup lang="ts">
import { appUserIdentity } from '~/composables/useAppSession'

const { t } = useI18n()
const { data: session, error: sessionError, status: sessionStatus, refresh: refreshSession } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const user = computed(() => session.value?.user ?? null)
const identity = computed(() => (user.value ? appUserIdentity(user.value) : ''))
const retryState = ref<'idle' | 'pending' | 'failed'>('idle')
const retrying = computed(() => retryState.value === 'pending')
const retryAnnouncement = computed<'polite' | 'assertive' | undefined>(() => {
  if (retryState.value === 'pending') return 'polite'
  if (retryState.value === 'failed') return 'assertive'
  return undefined
})

useHead(() => ({
  title: t('metadata.app.title')
}))

async function retrySession() {
  if (retrying.value) return

  retryState.value = 'pending'
  try {
    await refreshSession()
  } catch {
    retryState.value = 'failed'
    return
  }

  if (sessionError.value) {
    retryState.value = 'failed'
    return
  }

  retryState.value = 'idle'
  if (!session.value?.user) await navigateTo('/login')
}
</script>

<template>
  <div class="personal-app-page">
    <section class="personal-app-panel" aria-labelledby="personal-app-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('personalApp.eyebrow') }}</p>
        <h1 id="personal-app-title">
          {{ user?.displayName ? t('personalApp.welcomeNamed', { name: user.displayName }) : t('personalApp.welcome') }}
        </h1>
      </div>

      <AppNotice
        v-if="sessionError"
        :tone="retrying ? 'info' : 'error'"
        :announce="retryAnnouncement"
        :title="retrying ? t('personalApp.loading.title') : t('personalApp.unavailable.title')"
      >
        <p>{{ retrying ? t('common.checkingSession') : t('personalApp.unavailable.description') }}</p>
        <AppButton
          variant="secondary"
          :aria-busy="retrying ? 'true' : undefined"
          :aria-disabled="retrying ? 'true' : undefined"
          @click="retrySession"
        >
          {{ retrying ? t('common.checkingSession') : t('common.retry') }}
        </AppButton>
      </AppNotice>
      <AppNotice v-else-if="sessionStatus === 'pending' || !user" tone="info" :title="t('personalApp.loading.title')">
        <p>{{ t('personalApp.loading.description') }}</p>
      </AppNotice>

      <div v-else class="personal-app-content">
        <p>{{ t('personalApp.ready') }}</p>
        <i18n-t keypath="personalApp.signedInAs" tag="p" class="account-identity">
          <template #identity>
            <strong>{{ identity }}</strong>
          </template>
        </i18n-t>
        <NuxtLink class="account-link" to="/account">
          {{ t('personalApp.manageAccount') }}
        </NuxtLink>
      </div>
    </section>
  </div>
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
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .panel-heading {
    display: grid;
    gap: var(--space-1);
    margin-block-end: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
  }

  .personal-app-content {
    display: grid;
    gap: var(--space-4);
  }

  .personal-app-content p {
    margin: 0;
  }

  .account-identity {
    color: var(--color-text-muted);
  }

  .account-link {
    display: inline-flex;
    width: fit-content;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid var(--color-control-border);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-text);
    background: var(--color-surface);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
  }

  .account-link:hover,
  .account-link:focus-visible {
    border-color: var(--color-action);
    background: var(--color-action-soft);
  }

  @media (width <= 520px) {
    .account-link {
      width: 100%;
    }
  }
}
</style>
