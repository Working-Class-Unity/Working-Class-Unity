<script setup lang="ts">
const { t } = useI18n()
const { data: session, error: sessionError } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const user = computed(() => session.value?.user ?? null)

useHead(() => ({
  title: t('metadata.account.title')
}))

function accountDeleted() {
  session.value = null
}
</script>

<template>
  <AppPage class="account-page">
    <section class="panel account-panel" aria-labelledby="account-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('account.eyebrow') }}</p>
        <h1 id="account-title">{{ t('account.title') }}</h1>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('account.sessionUnavailable.title')"
        :description="t('common.sessionVerificationFailed')"
      />
      <UiStateBlock
        v-else-if="!user"
        tone="loading"
        :title="t('account.loginRequired.title')"
        :description="t('account.loginRequired.description')"
      />

      <div v-else class="account-content">
        <section aria-labelledby="identity-title">
          <h2 id="identity-title">{{ t('account.identity.title') }}</h2>
          <dl class="identity-list">
            <div>
              <dt>{{ t('account.identity.avatar') }}</dt>
              <dd>
                <!-- eslint-disable vue/html-self-closing -->
                <img
                  v-if="user.image"
                  class="profile-avatar"
                  :src="user.image"
                  :alt="t('account.identity.avatarAlt', { identity: user.name })"
                />
                <!-- eslint-enable vue/html-self-closing -->
                <span v-if="!user.image">{{ t('account.identity.noAvatar') }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ t('account.identity.displayName') }}</dt>
              <dd>{{ user.name }}</dd>
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
  </AppPage>
</template>

<style scoped>
@layer components {
  .account-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .account-panel {
    display: grid;
    min-width: 0;
    width: min(100%, 760px);
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .account-content,
  .identity-list {
    display: grid;
    min-width: 0;
    gap: var(--space-3);
  }

  .account-content > section + section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }

  .account-content h2 {
    font-size: 1.2rem;
  }

  .identity-list {
    margin: 0;
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
