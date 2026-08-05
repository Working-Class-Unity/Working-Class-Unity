<script setup lang="ts">
const { t } = useI18n()
const { data: session, error: sessionError } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const user = computed(() => session.value?.user ?? null)

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
          {{ user ? t('personalApp.welcomeNamed', { name: user.name }) : t('personalApp.welcome') }}
        </h1>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('personalApp.unavailable.title')"
        :description="t('personalApp.unavailable.description')"
      />
      <UiStateBlock
        v-else-if="!user"
        tone="loading"
        :title="t('personalApp.loading.title')"
        :description="t('personalApp.loading.description')"
      />

      <div v-else class="personal-app-content">
        <p>{{ t('personalApp.ready') }}</p>
        <i18n-t keypath="personalApp.signedInAs" tag="p" class="account-email">
          <template #email>
            <strong>{{ user.email }}</strong>
          </template>
        </i18n-t>
        <NuxtLink class="secondary-button account-link" to="/account">
          {{ t('personalApp.manageAccount') }}
        </NuxtLink>
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

  .personal-app-content {
    display: grid;
    gap: var(--space-4);
  }

  .personal-app-content p {
    margin: 0;
  }

  .account-email {
    color: var(--color-text-muted);
  }

  .account-link {
    width: fit-content;
    text-decoration: none;
  }

  @media (width <= 520px) {
    .account-link {
      width: 100%;
    }
  }
}
</style>
