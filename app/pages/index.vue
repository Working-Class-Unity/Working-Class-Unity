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

    <section class="home-features" :aria-label="t('home.featuresLabel')">
      <article class="panel feature-panel">
        <p class="eyebrow">{{ t('home.features.passwordless.eyebrow') }}</p>
        <h2>{{ t('home.features.passwordless.title') }}</h2>
        <p>{{ t('home.features.passwordless.description') }}</p>
      </article>
      <article class="panel feature-panel">
        <p class="eyebrow">{{ t('home.features.private.eyebrow') }}</p>
        <h2>{{ t('home.features.private.title') }}</h2>
        <p>{{ t('home.features.private.description') }}</p>
      </article>
      <article class="panel feature-panel">
        <p class="eyebrow">{{ t('home.features.adapt.eyebrow') }}</p>
        <h2>{{ t('home.features.adapt.title') }}</h2>
        <p>{{ t('home.features.adapt.description') }}</p>
      </article>
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

  .home-features {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .feature-panel {
    padding: var(--space-5);
  }

  .feature-panel h2 {
    margin-top: var(--space-2);
    font-size: 1.35rem;
  }

  .feature-panel p:last-child {
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
  }

  @media (width <= 900px) {
    .hero-panel,
    .home-features {
      grid-template-columns: 1fr;
    }
  }
}
</style>
