<script setup lang="ts">
const { t } = useI18n()

useHead(() => ({
  title: t('metadata.home.title'),
  meta: [
    {
      name: 'description',
      content: t('metadata.home.description')
    }
  ]
}))
</script>

<template>
  <AppPage class="home-page">
    <section class="panel hero-panel" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">{{ t('home.eyebrow') }}</p>
        <h1 id="home-title">{{ t('home.title') }}</h1>
        <p>{{ t('home.introduction') }}</p>
      </div>
      <div class="hero-actions" :aria-label="t('home.actionsLabel')">
        <NuxtLink class="primary-button action-link" to="/signup">{{ t('home.getStarted') }}</NuxtLink>
        <NuxtLink class="secondary-button action-link" to="/login">{{ t('navigation.login') }}</NuxtLink>
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .home-page {
    padding-bottom: var(--space-6);
  }

  .hero-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-6);
    align-items: end;
    padding: clamp(var(--space-5), 5vw, 56px);
  }

  .hero-copy {
    max-width: 760px;
  }

  .hero-copy p:last-child {
    max-width: 60ch;
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    font-size: 1.08rem;
  }

  .hero-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .action-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }

  @media (width <= 900px) {
    .hero-panel {
      grid-template-columns: 1fr;
    }
  }
}
</style>
