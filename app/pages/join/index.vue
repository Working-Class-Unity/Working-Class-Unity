<script setup lang="ts">
import { duesOptions, duesPortalUrl } from '#shared/membership-links'

const { t } = useI18n()
</script>

<template>
  <section class="join-page flow" aria-labelledby="join-title">
    <h1 id="join-title">{{ t('join.title') }}</h1>
    <p>{{ t('join.description') }}</p>
    <ul class="join-options" role="list" :aria-label="t('join.chooseTier')">
      <li v-for="option in duesOptions" :key="option.key" class="join-option">
        <h2>{{ t(`join.tiers.${option.key}.name`) }}</h2>
        <AppActionLink :to="option.url">{{ t(`join.tiers.${option.key}.price`) }}</AppActionLink>
      </li>
    </ul>
    <p>{{ t('join.tierExplanation') }}</p>
    <p>
      <a href="https://chat.workingclassunity.com/docs?topic=186">{{ t('join.codeOfConduct') }}</a>
    </p>
    <div class="join-manage flow">
      <h2>{{ t('join.manageTitle') }}</h2>
      <AppActionLink :to="duesPortalUrl" variant="secondary">{{ t('join.manageDues') }}</AppActionLink>
    </div>
  </section>
</template>

<style scoped>
@layer components {
  .join-page {
    min-inline-size: 0;
    max-inline-size: 48rem;
    margin-inline: auto;
    padding-block: var(--space-7);
    overflow-wrap: anywhere;
  }

  .join-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-5);
    padding: 0;
    list-style: none;
  }

  .join-option {
    display: grid;
    gap: var(--space-4);
    align-content: start;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
  }

  .join-option h2,
  .join-manage h2 {
    margin: 0;
    font-size: 1.375rem;
  }

  .join-manage {
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block-start: var(--space-6);
  }

  .join-manage .app-action-link {
    justify-self: start;
  }

  @media (width <= 32rem) {
    .join-options {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
