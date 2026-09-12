<script setup lang="ts">
import { duesOptions, duesPortalUrl } from '#shared/membership-links'

const { t } = useI18n()
const benefits = ['voting', 'leadership', 'campaigns', 'education'] as const
const questions = ['eligibility', 'good_standing', 'dues'] as const
</script>

<template>
  <article class="join-page" aria-labelledby="join-title">
    <header class="join-opening">
      <div class="join-heading-group">
        <p class="join-place">{{ t('join.hero.invitation') }}</p>
        <h1 id="join-title">{{ t('join.hero.title') }}</h1>
      </div>
      <div class="join-introduction">
        <p class="join-lede">{{ t('join.description') }}</p>
        <div class="join-opening-actions">
          <AppActionLink to="/calendar">{{ t('home.actions.events') }}</AppActionLink>
          <AppActionLink to="#membership" variant="text">{{ t('join.actions.membership') }}</AppActionLink>
        </div>
      </div>
    </header>

    <section id="membership" class="join-section" aria-labelledby="join-benefits-title">
      <div class="join-section-heading">
        <h2 id="join-benefits-title">{{ t('join.benefits.title') }}</h2>
        <p class="join-lede">{{ t('join.benefits.description') }}</p>
      </div>
      <div class="join-benefits-container">
        <dl class="join-benefits">
          <div v-for="benefit in benefits" :key="benefit" class="join-benefit">
            <dt>{{ t(`join.benefits.items.${benefit}.title`) }}</dt>
            <dd>{{ t(`join.benefits.items.${benefit}.description`) }}</dd>
          </div>
        </dl>
      </div>
      <AppActionLink to="/bylaws#article-iii" variant="text">{{ t('join.actions.bylaws') }}</AppActionLink>
    </section>

    <section class="join-section join-faq" aria-labelledby="join-faq-title">
      <div class="join-section-heading">
        <h2 id="join-faq-title">{{ t('join.faq.title') }}</h2>
        <p>{{ t('join.faq.subtitle') }}</p>
      </div>
      <div class="join-questions">
        <details v-for="question in questions" :key="question" :open="question === 'eligibility'">
          <summary>{{ t(`join.faq.items.${question}.question`) }}</summary>
          <p>{{ t(`join.faq.items.${question}.answer`) }}</p>
        </details>
      </div>
    </section>

    <section class="join-section join-payments" aria-labelledby="join-dues-title">
      <div class="join-section-heading">
        <h2 id="join-dues-title">{{ t('join.membership.title') }}</h2>
        <p>{{ t('join.tierExplanation') }}</p>
      </div>
      <div class="join-dues-container">
        <ul class="join-options" role="list" aria-labelledby="join-dues-title">
          <li v-for="option in duesOptions" :key="option.key" class="join-option">
            <div class="join-option-content">
              <h3 :id="`join-${option.key}-title`">{{ t(`join.membership.${option.key}.title`) }}</h3>
              <p :id="`join-${option.key}-price`" class="join-price">{{ t(`join.membership.${option.key}.price`) }}</p>
              <p>{{ t(`join.membership.${option.key}.description`) }}</p>
            </div>
            <AppActionLink
              :id="`join-${option.key}-action`"
              :to="option.url"
              :aria-labelledby="`join-${option.key}-action join-${option.key}-title join-${option.key}-price`"
              variant="secondary"
            >
              {{ t(`join.membership.${option.key}.button`) }}
            </AppActionLink>
          </li>
        </ul>
      </div>
      <div class="join-payment-explanation">
        <p>{{ t('join.paymentExplanation', { manageDues: t('join.manageDues') }) }}</p>
        <AppActionLink to="https://chat.workingclassunity.com/docs?topic=186" variant="text">
          {{ t('join.codeOfConduct') }}
        </AppActionLink>
      </div>
      <div class="join-manage">
        <h3>{{ t('join.manageTitle') }}</h3>
        <AppActionLink :to="duesPortalUrl" variant="text">{{ t('join.manageDues') }}</AppActionLink>
      </div>
    </section>
  </article>
</template>

<style scoped>
@layer components {
  .join-page {
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  .join-page p,
  .join-page h1,
  .join-page h2,
  .join-page h3,
  .join-page dl,
  .join-page dd {
    margin: 0;
  }

  .join-page p,
  .join-page dd {
    max-inline-size: 65ch;
    text-wrap: pretty;
  }

  .join-page h1,
  .join-page h2,
  .join-page h3 {
    text-wrap: balance;
  }

  .join-opening,
  .join-section {
    display: grid;
    gap: var(--space-6);
    padding-block: var(--space-8);
  }

  .join-heading-group,
  .join-introduction,
  .join-section-heading,
  .join-option-content,
  .join-payment-explanation {
    display: grid;
    min-inline-size: 0;
    align-content: start;
    gap: var(--space-5);
  }

  .join-place {
    color: var(--color-text-muted);
  }

  .join-page h1 {
    max-inline-size: 17ch;
  }

  .join-page h2 {
    max-inline-size: 28ch;
  }

  .join-lede {
    font-size: var(--font-size-lede);
  }

  .join-opening-actions {
    display: flex;
    align-items: start;
    flex-direction: column;
    gap: var(--space-3);
  }

  .join-section {
    border-block-start: var(--border-width) solid var(--color-divider);
    scroll-margin-block-start: var(--space-7);
  }

  .join-section > .app-action-link {
    justify-self: start;
  }

  .join-benefits-container {
    container: join-benefits / inline-size;
  }

  .join-benefits {
    display: grid;
    gap: var(--space-6);
  }

  .join-benefit {
    display: grid;
    min-inline-size: 0;
    align-content: start;
    gap: var(--space-3);
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block-start: var(--space-5);
  }

  .join-benefit dt {
    color: var(--color-brand-primary);
    font-size: 1.75rem;
    font-weight: var(--font-weight-strong);
  }

  .join-benefit dd {
    color: var(--color-text-muted);
    font-size: 1.125rem;
  }

  .join-questions {
    min-inline-size: 0;
  }

  .join-questions details {
    border-block-end: var(--border-width) solid var(--color-divider);
  }

  .join-questions details:first-child {
    border-block-start: var(--border-width) solid var(--color-divider);
  }

  .join-questions summary {
    min-block-size: var(--control-min-block-size);
    padding: var(--space-5) var(--space-2);
    color: var(--color-brand-primary);
    font-size: 1.125rem;
    font-weight: var(--font-weight-strong);
    cursor: pointer;
  }

  .join-questions summary::marker {
    color: var(--color-text-muted);
  }

  .join-questions summary:hover {
    background: var(--color-action-soft);
  }

  .join-questions summary:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  .join-questions details > p {
    padding: 0 var(--space-2) var(--space-5);
  }

  .join-dues-container {
    container: join-dues / inline-size;
  }

  .join-options {
    display: grid;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .join-option {
    display: flex;
    min-inline-size: 0;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--space-6);
    border-block-start: var(--border-width-accent) solid var(--color-brand-primary);
    padding-block-start: var(--space-5);
  }

  .join-price {
    color: var(--color-brand-primary);
    font-size: 2rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-strong);
  }

  .join-payment-explanation {
    color: var(--color-text-muted);
  }

  .join-payment-explanation .app-action-link {
    justify-self: start;
    text-align: start;
  }

  .join-manage {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-6);
    border-block-start: var(--border-width) solid var(--color-divider);
    padding-block-start: var(--space-5);
  }

  .join-manage h3 {
    min-inline-size: 0;
    font-size: 1.25rem;
  }

  @container join-benefits (min-width: 40rem) {
    .join-benefits {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .join-benefit dd {
      font-size: 1rem;
    }
  }

  @container join-dues (min-width: 40rem) {
    .join-options {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (width >= 56rem) {
    .join-opening,
    .join-faq {
      align-items: start;
    }

    .join-opening {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    }

    .join-faq {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    }

    .join-opening,
    .join-section {
      padding-block: var(--space-9);
    }
  }
}
</style>
