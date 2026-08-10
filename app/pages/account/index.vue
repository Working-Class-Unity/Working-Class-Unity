<script setup lang="ts">
import type { AccountProfile } from '#shared/profile'
import { appUserIdentity, type AppSessionUser } from '~/composables/useAppSession'

type AccountSettingsUser = AppSessionUser & AccountProfile

const { t } = useI18n()
const { data: appSession, refresh: refreshAppSession } = await useAppSession()
const {
  data: account,
  error: sessionError,
  status: sessionStatus,
  refresh: refreshAccount
} = await useFetch<{ user: AccountSettingsUser }>('/api/me', {
  key: 'account-profile',
  dedupe: 'defer'
})

if (!account.value?.user && (!sessionError.value || sessionError.value.statusCode === 401)) {
  await navigateTo('/login', { redirectCode: 302 })
}

const user = computed(() => account.value?.user ?? null)
const retryState = ref<'idle' | 'pending' | 'failed'>('idle')
const retrying = computed(() => retryState.value === 'pending')
const retryAnnouncement = computed<'polite' | 'assertive' | undefined>(() => {
  if (retryState.value === 'pending') return 'polite'
  if (retryState.value === 'failed') return 'assertive'
  return undefined
})

useHead(() => ({
  title: t('metadata.account.title')
}))

function accountDeleted() {
  account.value = undefined
  appSession.value = null
}

function profileUpdated(profile: AccountProfile) {
  if (!account.value?.user) return
  account.value = {
    ...account.value,
    user: {
      ...account.value.user,
      ...profile
    }
  }
  if (appSession.value?.user) {
    appSession.value = {
      ...appSession.value,
      user: {
        ...appSession.value.user,
        displayName: profile.displayName
      }
    }
  }
}

async function retrySession() {
  if (retrying.value) return

  retryState.value = 'pending'
  try {
    await Promise.all([refreshAccount(), refreshAppSession()])
  } catch {
    retryState.value = 'failed'
    return
  }

  if (sessionError.value) {
    if (sessionError.value.statusCode === 401) {
      await navigateTo('/login')
      return
    }
    retryState.value = 'failed'
    return
  }

  retryState.value = 'idle'
  if (!account.value?.user) await navigateTo('/login')
}
</script>

<template>
  <div class="account-page">
    <section class="account-panel" aria-labelledby="account-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('account.eyebrow') }}</p>
        <h1 id="account-title">{{ t('account.title') }}</h1>
      </div>

      <AppNotice
        v-if="sessionError"
        :tone="retrying ? 'info' : 'error'"
        :announce="retryAnnouncement"
        :title="retrying ? t('account.loginRequired.title') : t('account.sessionUnavailable.title')"
      >
        <p>{{ retrying ? t('common.checkingSession') : t('common.sessionVerificationFailed') }}</p>
        <AppButton
          variant="secondary"
          :aria-busy="retrying ? 'true' : undefined"
          :aria-disabled="retrying ? 'true' : undefined"
          @click="retrySession"
        >
          {{ retrying ? t('common.checkingSession') : t('common.retry') }}
        </AppButton>
      </AppNotice>
      <AppNotice v-else-if="sessionStatus === 'pending' || !user" tone="info" :title="t('account.loginRequired.title')">
        <p>{{ t('account.loginRequired.description') }}</p>
      </AppNotice>

      <div v-else class="account-content">
        <AccountProfileForm :user="user" @updated="profileUpdated" />

        <section aria-labelledby="identity-title">
          <h2 id="identity-title">{{ t('account.identity.title') }}</h2>
          <dl class="identity-list grid">
            <div>
              <dt>{{ t('account.identity.avatar') }}</dt>
              <dd>
                <!-- eslint-disable vue/html-self-closing -->
                <img
                  v-if="user.image"
                  class="profile-avatar"
                  :src="user.image"
                  :alt="t('account.identity.avatarAlt', { identity: appUserIdentity(user) })"
                />
                <!-- eslint-enable vue/html-self-closing -->
                <span v-if="!user.image">{{ t('account.identity.noAvatar') }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ t('common.email') }}</dt>
              <dd>{{ user.email }}</dd>
            </div>
          </dl>
        </section>

        <AccountDeletionSection @deleted="accountDeleted" />
      </div>
    </section>
  </div>
</template>

<style scoped>
@layer components {
  .account-page {
    display: grid;
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .account-panel {
    display: grid;
    min-width: 0;
    width: min(100%, 760px);
    gap: var(--space-4);
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

  .account-content {
    display: grid;
    min-width: 0;
    gap: var(--space-3);
  }

  .identity-list {
    min-width: 0;
    margin: 0;
  }

  .account-content > section + section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }

  .account-content h2 {
    font-size: 1.2rem;
  }

  .identity-list div {
    min-width: 0;
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }

  .identity-list dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .identity-list dd {
    overflow-wrap: anywhere;
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-strong);
  }

  .profile-avatar {
    display: block;
    width: 72px;
    height: 72px;
    border: var(--border-width) solid var(--color-border);
    border-radius: 50%;
    object-fit: cover;
  }
}
</style>
