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
  <div class="home-page">
    <section class="hero-panel grid" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">{{ t('home.eyebrow') }}</p>
        <h1 id="home-title">{{ t('home.title') }}</h1>
        <p>{{ t('home.introduction') }}</p>
      </div>
      <div class="hero-actions cluster" :aria-label="t('home.actionsLabel')">
        <NuxtLink class="action-link action-link-primary" to="/signup">{{ t('home.getStarted') }}</NuxtLink>
        <NuxtLink class="action-link action-link-secondary" to="/login">{{ t('navigation.login') }}</NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
@layer components {
  .home-page {
    padding-bottom: var(--space-6);
  }

  .hero-panel {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-6);
    align-items: end;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: clamp(var(--space-5), 5vw, 56px);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
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
    align-items: stretch;
  }

  .action-link {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid var(--color-action);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
  }

  .action-link-primary {
    color: var(--color-action-contrast);
    background: var(--color-action);
  }

  .action-link-primary:hover,
  .action-link-primary:focus-visible {
    filter: brightness(0.9);
  }

  .action-link-secondary {
    border-color: var(--color-control-border);
    color: var(--color-text);
    background: var(--color-surface);
  }

  .action-link-secondary:hover,
  .action-link-secondary:focus-visible {
    border-color: var(--color-action);
    background: var(--color-action-soft);
  }

  @media (width <= 900px) {
    .hero-panel {
      grid-template-columns: 1fr;
    }
  }
}
</style>
