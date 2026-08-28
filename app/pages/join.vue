<script setup lang="ts">
import { isMembershipDuesOfferingKey, type MembershipDuesOfferingKey } from '#shared/billing'
import { membershipJoinReturnPath } from '#shared/auth-routes'
import type { AccountMembershipState } from '#shared/membership'

type JoinChoice = 'supporter' | MembershipDuesOfferingKey

const route = useRoute()
const { t } = useI18n()
const { data: session } = await useAppSession()
const initialOffering = Array.isArray(route.query.offering) ? route.query.offering[0] : route.query.offering
const selected = ref<JoinChoice>(
  typeof initialOffering === 'string' && isMembershipDuesOfferingKey(initialOffering) ? initialOffering : 'supporter'
)
const submitting = ref(false)
const commandError = ref('')

const { data: accountMembership } = await useAsyncData<AccountMembershipState | null>('join-account-membership', () =>
  session.value?.user ? $fetch('/api/account/membership') : Promise.resolve(null)
)

const options = computed(() => [
  {
    value: 'supporter',
    title: t('join.options.supporter.title'),
    description: t('join.options.supporter.description'),
    price: t('join.options.supporter.price')
  },
  {
    value: 'personal.monthly',
    title: t('join.options.membership.title'),
    description: t('join.options.membership.description'),
    price: t('join.options.membership.price'),
    disabled: hasPaidMembership.value
  },
  {
    value: 'family.monthly',
    title: t('join.options.solidarity.title'),
    description: t('join.options.solidarity.description'),
    price: t('join.options.solidarity.price'),
    disabled: hasPaidMembership.value
  }
])
const selectedOption = computed(
  () => options.value.find((option) => option.value === selected.value) ?? options.value[0]!
)
const hasPaidMembership = computed(
  () =>
    Boolean(accountMembership.value?.access.granted) ||
    Boolean(accountMembership.value && accountMembership.value.billing.subscription.offering !== null)
)
const isPaidChoice = computed(() => isMembershipDuesOfferingKey(selected.value))
const signInReturnTo = computed(() =>
  isMembershipDuesOfferingKey(selected.value) ? membershipJoinReturnPath(selected.value) : '/join'
)
const cancelled = computed(() => route.query.checkout === 'cancelled')
const actionLabel = computed(() => {
  if (hasPaidMembership.value) return t('join.actions.manage')
  if (selected.value === 'supporter') {
    return session.value?.user ? t('join.actions.account') : t('join.actions.supporter')
  }
  return t('join.actions.paid', { amount: selected.value === 'personal.monthly' ? 10 : 27 })
})

useHead(() => ({
  title: t('metadata.join.title'),
  meta: [{ name: 'description', content: t('metadata.join.description') }]
}))

async function continueJoin() {
  if (submitting.value) return
  commandError.value = ''
  if (hasPaidMembership.value) {
    await navigateTo('/account')
    return
  }
  if (!isPaidChoice.value) {
    await navigateTo(session.value?.user ? '/app' : '/signup')
    return
  }

  submitting.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/join/checkout', {
      method: 'POST',
      body: { offering: selected.value }
    })
    if (new URL(result.url).protocol !== 'https:') throw new Error('Unexpected Checkout URL')
    await navigateTo(result.url, { external: true })
  } catch {
    commandError.value = t('join.checkoutError')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <article class="join-page" aria-labelledby="join-title">
    <header class="join-heading">
      <p class="join-eyebrow">{{ t('join.eyebrow') }}</p>
      <h1 id="join-title">{{ t('join.title') }}</h1>
      <p>{{ t('join.introduction') }}</p>
    </header>

    <AppNotice v-if="cancelled" tone="info" :title="t('join.cancelledTitle')">
      {{ t('join.cancelled') }}
    </AppNotice>

    <AppNotice v-if="hasPaidMembership" tone="info" :title="t('join.existingMembershipTitle')">
      {{ t('join.existingMembership') }}
    </AppNotice>

    <div class="join-layout">
      <section class="join-choices" aria-labelledby="join-options-title">
        <h2 id="join-options-title">{{ t('join.optionsTitle') }}</h2>
        <JoinOptionGroup v-model="selected" :label="t('join.optionsLabel')" :options="options" :disabled="submitting" />
      </section>

      <section class="join-next" aria-labelledby="join-next-title">
        <h2 id="join-next-title">{{ t('join.next.title') }}</h2>

        <div class="join-selection" aria-live="polite">
          <span>{{ t('join.next.selected') }}</span>
          <div>
            <strong>{{ selectedOption.title }}</strong>
            <strong>{{ selectedOption.price }}</strong>
          </div>
          <p>{{ selectedOption.description }}</p>
        </div>

        <ol class="join-steps">
          <template v-if="isPaidChoice">
            <li>
              <span class="step-number" aria-hidden="true">1</span>
              <div>
                <strong>{{ t('join.next.checkoutTitle') }}</strong>
                <p>{{ t('join.next.checkoutDescription') }}</p>
              </div>
            </li>
            <li>
              <span class="step-number" aria-hidden="true">2</span>
              <div>
                <strong>{{ t('join.next.finishTitle') }}</strong>
                <p>{{ t('join.next.finishDescription') }}</p>
              </div>
            </li>
          </template>
          <template v-else>
            <li>
              <span class="step-number" aria-hidden="true">1</span>
              <div>
                <strong>{{ t('join.next.supporterTitle') }}</strong>
                <p>{{ t('join.next.supporterDescription') }}</p>
              </div>
            </li>
          </template>
        </ol>

        <AppNotice v-if="commandError" tone="error" announce="assertive">{{ commandError }}</AppNotice>

        <AppButton class="join-action" :pending="submitting" @click="continueJoin">
          {{ actionLabel }}
        </AppButton>

        <p v-if="!session?.user" class="join-login">
          {{ t('join.signInPrompt') }}
          <NuxtLink :to="{ path: '/login', query: { returnTo: signInReturnTo } }">{{ t('join.signIn') }}</NuxtLink>
        </p>
      </section>
    </div>

    <aside class="join-rights" :aria-label="t('join.rights.label')">
      <span class="rights-star" aria-hidden="true">★</span>
      <div>
        <strong>{{ t('join.rights.title') }}</strong>
        <p>{{ t('join.rights.description') }}</p>
      </div>
    </aside>
  </article>
</template>

<style scoped>
@layer components {
  .join-page {
    display: grid;
    gap: var(--space-4);
    padding-block-end: var(--space-6);
  }

  .join-heading {
    display: grid;
    gap: var(--space-2);
    max-inline-size: 44rem;
  }

  .join-heading p,
  .join-heading h1,
  .join-choices h2,
  .join-next h2,
  .join-selection p,
  .join-steps p,
  .join-login,
  .join-rights p {
    margin: 0;
  }

  .join-eyebrow {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .join-heading h1 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(3rem, 2rem + 3vw, 5rem);
    font-stretch: 112%;
    font-weight: 650;
    letter-spacing: -0.055em;
    line-height: 0.96;
  }

  .join-heading > :last-child {
    color: var(--color-text);
    font-size: clamp(1.05rem, 0.98rem + 0.25vw, 1.25rem);
    line-height: 1.55;
  }

  .join-layout {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(21rem, 5fr);
    gap: clamp(var(--space-4), 3vw, var(--space-6));
    align-items: stretch;
  }

  .join-choices,
  .join-next {
    display: grid;
    gap: var(--space-4);
    align-content: start;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: clamp(var(--space-4), 3vw, var(--space-5));
    background: var(--color-surface);
  }

  .join-next {
    background: linear-gradient(145deg, var(--color-surface), var(--color-action-soft));
  }

  .join-choices h2,
  .join-next h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.65rem, 1.35rem + 0.8vw, 2.25rem);
    letter-spacing: -0.035em;
    line-height: 1.1;
  }

  .join-selection {
    display: grid;
    gap: var(--space-1);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
  }

  .join-selection > span {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
  }

  .join-selection > div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--color-brand-primary);
    font-size: 1.2rem;
  }

  .join-steps strong {
    color: var(--color-brand-primary);
    font-size: 1.05rem;
  }

  .join-selection > div strong:last-child {
    white-space: nowrap;
  }

  .join-selection p {
    color: var(--color-text-muted);
    line-height: 1.45;
  }

  .join-steps {
    display: grid;
    gap: var(--space-4);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .join-steps li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3);
  }

  .join-steps p {
    margin-block-start: var(--space-1);
    color: var(--color-text-muted);
    line-height: 1.45;
  }

  .step-number {
    display: grid;
    place-items: center;
    inline-size: 2.25rem;
    block-size: 2.25rem;
    border-radius: 50%;
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
    font-weight: var(--font-weight-heavy);
  }

  .join-action {
    --color-action: var(--color-accent-action);
    --color-action-contrast: var(--color-accent-action-contrast);

    inline-size: 100%;
  }

  .join-login {
    color: var(--color-text-muted);
    text-align: center;
  }

  .join-rights {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    color: var(--color-brand-primary);
    background: var(--color-surface);
  }

  .rights-star {
    color: var(--color-brand-highlight);
    font-size: 2.25rem;
    line-height: 1;
  }

  .join-rights p {
    margin-block-start: var(--space-1);
    color: var(--color-text-muted);
  }

  @media (width <= 58rem) {
    .join-layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (width <= 36rem) {
    .join-page {
      gap: var(--space-3);
    }

    .join-choices,
    .join-next {
      padding: var(--space-3);
    }

    .join-selection > div,
    .join-rights {
      align-items: flex-start;
    }

    .join-selection > div {
      flex-direction: column;
      gap: var(--space-1);
    }
  }
}
</style>
