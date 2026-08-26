<script setup lang="ts">
import type { BillingOfferingKey, MembershipDuesOfferingKey } from '#shared/billing'
import { isStripeMembershipCancellationScheduled, type AccountMembershipState } from '#shared/membership'

type BillingOperation = 'change' | 'checkout' | 'portal' | 'reconcile'

const { t } = useI18n()
const route = useRoute()
const {
  data: state,
  error: loadError,
  status,
  refresh
} = await useFetch<AccountMembershipState>('/api/account/membership', { key: 'account-membership', dedupe: 'defer' })
const operation = ref<BillingOperation | null>(null)
const commandError = ref('')
const commandSuccess = ref('')

const offerings = [
  { amount: 10, key: 'personal.monthly' },
  { amount: 27, key: 'family.monthly' }
] as const satisfies ReadonlyArray<{ amount: number; key: MembershipDuesOfferingKey }>

const contributionAmount = computed(() => amountFor(state.value?.access.offering ?? null))
const isGrace = computed(() => state.value?.access.state === 'grace')
const isNonrenewing = computed(() => Boolean(state.value && isStripeMembershipCancellationScheduled(state.value)))
const hasOfferingAction = computed(() => offerings.some(({ key }) => actionFor(key) !== null))

onMounted(async () => {
  if (route.query.checkout === 'success' && state.value?.billing.capabilities.canReconcile) {
    await reconcile(true)
  }
})

function amountFor(offering: BillingOfferingKey | null): number | null {
  return offerings.find(({ key }) => key === offering)?.amount ?? null
}

function formatDate(value: string | null): string {
  if (!value) return t('account.membership.dateUnavailable')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return t('account.membership.dateUnavailable')
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

function actionFor(offering: MembershipDuesOfferingKey): 'change' | 'checkout' | 'current' | 'scheduled' | null {
  if (!state.value) return null
  if (state.value.billing.transition?.targetOffering === offering) return 'scheduled'
  if (state.value.billing.subscription.offering === offering) return 'current'
  if (state.value.billing.capabilities.canCheckout) return 'checkout'
  if (state.value.billing.capabilities.canChange) return 'change'
  return null
}

function actionLabel(offering: MembershipDuesOfferingKey): string {
  const amount = amountFor(offering)
  const action = actionFor(offering)
  if (action === 'current') return t('account.membership.currentContribution')
  if (action === 'scheduled') return t('account.membership.scheduledContribution')
  if (action === 'change') return t('account.membership.changeContribution', { amount })
  return t('account.membership.joinContribution', { amount })
}

async function chooseOffering(offering: MembershipDuesOfferingKey) {
  const action = actionFor(offering)
  if (operation.value || (action !== 'checkout' && action !== 'change')) return
  clearCommandStatus()
  operation.value = action
  try {
    if (action === 'checkout') {
      const result = await $fetch<{ url: string }>('/api/account/billing/checkout', {
        method: 'POST',
        body: { offering }
      })
      if (!result.url.startsWith('https://')) throw new Error('Unexpected Checkout URL')
      await navigateTo(result.url, { external: true })
      return
    }
    await $fetch('/api/account/billing/change', { method: 'POST', body: { offering } })
    await refresh()
    commandSuccess.value = t('account.membership.changeSaved')
  } catch {
    commandError.value = t('account.membership.commandError')
  } finally {
    operation.value = null
  }
}

async function openPortal() {
  if (operation.value) return
  clearCommandStatus()
  operation.value = 'portal'
  try {
    const result = await $fetch<{ url: string }>('/api/account/billing/portal', { method: 'POST', body: {} })
    if (!result.url.startsWith('https://')) throw new Error('Unexpected Portal URL')
    await navigateTo(result.url, { external: true })
  } catch {
    commandError.value = t('account.membership.commandError')
  } finally {
    operation.value = null
  }
}

async function reconcile(quiet = false) {
  if (operation.value) return
  if (!quiet) clearCommandStatus()
  operation.value = 'reconcile'
  try {
    await $fetch('/api/account/billing/reconcile', { method: 'POST', body: {} })
    await refresh()
    if (!quiet) commandSuccess.value = t('account.membership.refreshed')
  } catch {
    commandError.value = t('account.membership.commandError')
  } finally {
    operation.value = null
  }
}

function clearCommandStatus() {
  commandError.value = ''
  commandSuccess.value = ''
}
</script>

<template>
  <section class="account-section membership-section" aria-labelledby="membership-settings-title">
    <div>
      <h2 id="membership-settings-title">{{ t('account.membership.title') }}</h2>
      <p>{{ t('account.membership.description') }}</p>
    </div>

    <AppNotice v-if="loadError" tone="error" announce="assertive">
      {{ t('account.membership.loadError') }}
    </AppNotice>
    <AppNotice v-else-if="status === 'pending' || !state" tone="info">
      {{ t('account.membership.loading') }}
    </AppNotice>

    <template v-else>
      <dl class="membership-summary">
        <div>
          <dt>{{ t('account.membership.accountType') }}</dt>
          <dd>{{ state.level === 'member' ? t('account.membership.member') : t('account.membership.supporter') }}</dd>
        </div>
        <div v-if="contributionAmount !== null">
          <dt>{{ t('account.membership.contribution') }}</dt>
          <dd>{{ t('account.membership.amountMonthly', { amount: contributionAmount }) }}</dd>
        </div>
      </dl>

      <AppNotice v-if="state.identityReviewPending" tone="warning" :title="t('account.membership.identityReviewTitle')">
        <p>{{ t('account.membership.identityReview') }}</p>
        <p><a href="mailto:info@workingclassunity.com">info@workingclassunity.com</a></p>
      </AppNotice>

      <AppNotice v-if="isGrace" tone="warning" :title="t('account.membership.paymentProblemTitle')">
        <p>{{ t('account.membership.paymentProblem', { deadline: formatDate(state.access.graceDeadline) }) }}</p>
      </AppNotice>
      <AppNotice v-else-if="isNonrenewing" tone="info" :title="t('account.membership.cancellationTitle')">
        <p>
          {{
            t('account.membership.cancellation', { deadline: formatDate(state.billing.subscription.currentPeriodEnd) })
          }}
        </p>
      </AppNotice>
      <AppNotice v-if="state.billing.transition" tone="info" :title="t('account.membership.changePendingTitle')">
        <p>
          {{
            t('account.membership.changePending', {
              amount: amountFor(state.billing.transition.targetOffering),
              deadline: formatDate(state.billing.transition.effectiveAt)
            })
          }}
        </p>
      </AppNotice>
      <AppNotice v-if="route.query.checkout === 'cancelled'" tone="info">
        {{ t('account.membership.checkoutCancelled') }}
      </AppNotice>

      <AppNotice v-if="commandError" tone="error" announce="assertive">
        <p>{{ commandError }}</p>
        <p><a href="mailto:info@workingclassunity.com">info@workingclassunity.com</a></p>
      </AppNotice>
      <AppNotice v-else-if="commandSuccess" tone="success" announce="polite">{{ commandSuccess }}</AppNotice>

      <div v-if="hasOfferingAction" class="contribution-grid">
        <article v-for="offering in offerings" :key="offering.key" class="contribution-option">
          <h3>{{ t('account.membership.amountMonthly', { amount: offering.amount }) }}</h3>
          <p>{{ t('account.membership.equalRights') }}</p>
          <AppButton
            v-if="actionFor(offering.key)"
            :disabled="actionFor(offering.key) === 'current' || actionFor(offering.key) === 'scheduled'"
            :pending="operation === actionFor(offering.key)"
            @click="chooseOffering(offering.key)"
          >
            {{ actionLabel(offering.key) }}
          </AppButton>
        </article>
      </div>

      <div class="membership-commands">
        <AppButton
          v-if="state.billing.capabilities.canManage"
          variant="secondary"
          :pending="operation === 'portal'"
          :disabled="operation !== null && operation !== 'portal'"
          @click="openPortal"
        >
          {{ isGrace ? t('account.membership.fixPayment') : t('account.membership.managePayment') }}
        </AppButton>
        <AppButton
          v-if="state.billing.capabilities.canReconcile"
          variant="secondary"
          :pending="operation === 'reconcile'"
          :disabled="operation !== null && operation !== 'reconcile'"
          @click="reconcile()"
        >
          {{ t('account.membership.refresh') }}
        </AppButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
@layer components {
  .membership-section,
  .membership-summary,
  .contribution-option {
    display: grid;
    gap: var(--space-3);
  }

  .membership-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
  }

  .membership-summary div,
  .contribution-option {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    background: var(--color-surface);
  }

  .membership-summary dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .membership-summary dd {
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-heavy);
  }

  .contribution-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .contribution-option h3,
  .contribution-option p {
    margin: 0;
  }

  .contribution-option :deep(button) {
    width: 100%;
  }

  .membership-commands {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  @media (width <= 620px) {
    .membership-summary,
    .contribution-grid {
      grid-template-columns: 1fr;
    }

    .membership-commands,
    .membership-commands :deep(button) {
      width: 100%;
    }
  }
}
</style>
