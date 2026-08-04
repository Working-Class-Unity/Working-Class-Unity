<script setup lang="ts">
import type { BillingAccountState, BillingCadence, BillingOfferingKey, BillingPlan } from '#shared/billing'
import { isPublicModuleReady, moduleDisabledCode } from '#shared/module-states'
import { responseStatus } from '~/utils/http-error'

type BillingStateEnvelope = Readonly<{
  userId: string
  state: BillingAccountState
}>

type BillingPresentation = Readonly<{
  title: string
  description: string
  tone: 'success' | 'warning' | 'info'
}>

type RedirectResponse = Readonly<{ url: string }>
type BillingAction =
  '' | 'portal' | 'reconcile' | 'leave' | `checkout:${BillingOfferingKey}` | `change:${BillingOfferingKey}`
type ActionRequest = Readonly<{
  controller: AbortController
  generation: number
  userId: string
}>

const { d, t } = useI18n()
const config = useRuntimeConfig()
const billingReady = isPublicModuleReady(config.public.moduleStates, 'billing')

if (!billingReady) {
  throw createError({
    status: 404,
    statusText: 'Page Not Found',
    fatal: import.meta.client,
    data: { code: moduleDisabledCode, module: 'billing' }
  })
}

const route = useRoute()
const { data: session, error: sessionError, status: sessionStatus, refresh: refreshSession } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const requestFetch = useRequestFetch()
const sessionUserId = computed(() => session.value?.user.id ?? null)
const activeAction = ref<BillingAction>('')
const actionError = ref('')
const actionStatus = ref('')
const confirmingLeave = ref(false)
const leaveCommitted = ref(false)
const leaveOutcomeUncertain = ref(false)
const leaveTrigger = ref<HTMLButtonElement | null>(null)
const leaveConfirmation = ref<HTMLButtonElement | null>(null)
let losingSession = false
let sessionVerificationFailed = Boolean(sessionError.value)
let actionRequestGeneration = 0
let actionAbortController: AbortController | undefined

const {
  data: billingEnvelope,
  error: billingError,
  status: billingStatus,
  refresh: executeBillingRequest,
  clear: clearBillingRequest
} = await useAsyncData<BillingStateEnvelope>(
  'stripe-billing-account',
  async (_nuxtApp, { signal }) => {
    const requestedUserId = sessionUserId.value
    if (!requestedUserId) throw new Error('An authenticated user is required to load billing.')
    const state = await requestFetch<BillingAccountState>('/api/account/billing', { signal })
    return { userId: requestedUserId, state }
  },
  {
    enabled: () => Boolean(sessionUserId.value),
    lazy: true
  }
)

const billingState = computed(() =>
  sessionUserId.value && billingEnvelope.value?.userId === sessionUserId.value ? billingEnvelope.value.state : null
)
const billingPending = computed(() => billingStatus.value === 'pending')
const isBusy = computed(() => activeAction.value !== '')
const isMember = computed(() => billingState.value?.relationship.kind === 'member')
const checkoutReturn = computed(() => {
  const value = Array.isArray(route.query.checkout) ? route.query.checkout[0] : route.query.checkout
  return value === 'success' || value === 'cancelled' ? value : null
})
const statusPresentation = computed<BillingPresentation>(() => presentBillingState(billingState.value))
const checkoutOfferings = computed(() =>
  billingState.value?.capabilities.canCheckout ? billingState.value.catalog : []
)
const changeOfferings = computed(
  () =>
    billingState.value?.catalog.filter(
      (offering) =>
        billingState.value?.capabilities.canChange &&
        (offering.plan !== billingState.value.subscription.plan ||
          offering.cadence !== billingState.value.subscription.cadence)
    ) ?? []
)

useHead(() => ({
  title: t('metadata.billing.title')
}))

watch(sessionUserId, async (userId, previousUserId) => {
  if (userId === previousUserId) return

  resetPrivateState()
  if (userId) {
    await refreshBilling()
  } else if (previousUserId) {
    await loseSession()
  }
})

watch([sessionError, sessionStatus], ([error, status]) => {
  if (error) {
    sessionVerificationFailed = true
    return
  }
  if (sessionVerificationFailed && status !== 'pending' && !sessionUserId.value) void loseSession()
})

if (responseStatus(billingError.value) === 401) {
  await loseSession()
}

watch(billingError, (error) => {
  if (responseStatus(error) === 401) void loseSession()
})

onScopeDispose(() => {
  if (!import.meta.server) resetPrivateState()
})

async function refreshBilling() {
  if (!sessionUserId.value) {
    await loseSession()
    return
  }

  await executeBillingRequest()
  if (responseStatus(billingError.value) === 401) {
    await loseSession()
  } else if (!billingError.value && (leaveCommitted.value || leaveOutcomeUncertain.value)) {
    const leftFamily = billingState.value?.relationship.kind !== 'member'
    leaveCommitted.value = false
    leaveOutcomeUncertain.value = false
    confirmingLeave.value = !leftFamily
    if (leftFamily) {
      actionStatus.value = t('billing.feedback.left')
    } else {
      actionError.value = t('billing.feedback.leaveUnconfirmed')
    }
    await focusActionStatus()
  }
}

async function startCheckout(offering: BillingOfferingKey) {
  if (isBusy.value || !billingState.value?.capabilities.canCheckout) return

  const initiatingUserId = sessionUserId.value
  if (!initiatingUserId) {
    await loseSession()
    return
  }

  clearActionFeedback()
  const action = `checkout:${offering}` as const
  const request = beginAction(action, initiatingUserId)

  try {
    const result = await $fetch<RedirectResponse>('/api/account/billing/checkout', {
      method: 'POST',
      signal: request.controller.signal,
      body: { offering }
    })
    if (!isCurrentAction(request)) return
    if (!isSecureExternalUrl(result.url)) throw new Error('Invalid billing redirect')
    await navigateTo(result.url, { external: true })
  } catch (error) {
    if (!isCurrentAction(request)) return
    if (responseStatus(error) === 401) {
      await loseSession()
      return
    }
    actionError.value = t('billing.feedback.checkoutFailed')
    await focusActionStatus()
  } finally {
    finishAction(request)
  }
}

async function changeOffering(offering: BillingOfferingKey) {
  if (isBusy.value || !billingState.value?.capabilities.canChange) return

  const initiatingUserId = sessionUserId.value
  if (!initiatingUserId) {
    await loseSession()
    return
  }

  clearActionFeedback()
  const action = `change:${offering}` as const
  const request = beginAction(action, initiatingUserId)

  try {
    const state = await $fetch<BillingAccountState>('/api/account/billing/change', {
      method: 'POST',
      signal: request.controller.signal,
      body: { offering }
    })
    if (!isCurrentAction(request)) return
    billingEnvelope.value = { userId: initiatingUserId, state }
    actionStatus.value = state.transition ? t('billing.feedback.changePending') : t('billing.feedback.changeApplied')
    await focusActionStatus()
  } catch (error) {
    if (!isCurrentAction(request)) return
    if (responseStatus(error) === 401) {
      await loseSession()
      return
    }
    actionError.value = t('billing.feedback.changeFailed')
    await focusActionStatus()
  } finally {
    finishAction(request)
  }
}

async function openBillingPortal() {
  if (isBusy.value || !billingState.value?.capabilities.canManage) return

  const initiatingUserId = sessionUserId.value
  if (!initiatingUserId) {
    await loseSession()
    return
  }

  clearActionFeedback()
  const request = beginAction('portal', initiatingUserId)

  try {
    const result = await $fetch<RedirectResponse>('/api/account/billing/portal', {
      method: 'POST',
      signal: request.controller.signal,
      body: {}
    })
    if (!isCurrentAction(request)) return
    if (!isSecureExternalUrl(result.url)) throw new Error('Invalid billing redirect')
    await navigateTo(result.url, { external: true })
  } catch (error) {
    if (!isCurrentAction(request)) return
    if (responseStatus(error) === 401) {
      await loseSession()
      return
    }
    actionError.value = t('billing.feedback.portalFailed')
    await focusActionStatus()
  } finally {
    finishAction(request)
  }
}

async function reconcileBilling() {
  if (isBusy.value || !billingState.value?.capabilities.canReconcile) return

  const initiatingUserId = sessionUserId.value
  if (!initiatingUserId) {
    await loseSession()
    return
  }

  clearActionFeedback()
  const request = beginAction('reconcile', initiatingUserId)
  try {
    const state = await $fetch<BillingAccountState>('/api/account/billing/reconcile', {
      method: 'POST',
      signal: request.controller.signal,
      body: {}
    })
    if (!isCurrentAction(request)) return
    billingEnvelope.value = { userId: initiatingUserId, state }
    actionStatus.value = t('billing.feedback.refreshed')
    await focusActionStatus()
  } catch (error) {
    if (!isCurrentAction(request)) return
    if (responseStatus(error) === 401) {
      await loseSession()
      return
    }
    actionError.value = t('billing.feedback.refreshFailed')
    await focusActionStatus()
  } finally {
    finishAction(request)
  }
}

async function revealLeaveConfirmation() {
  if (isBusy.value || !billingState.value?.capabilities.canLeaveFamily) return
  clearActionFeedback()
  confirmingLeave.value = true
  await nextTick()
  leaveConfirmation.value?.focus()
}

async function cancelLeave() {
  confirmingLeave.value = false
  await nextTick()
  leaveTrigger.value?.focus()
}

async function leaveFamilyMembership() {
  if (isBusy.value || !billingState.value?.capabilities.canLeaveFamily) return

  const initiatingUserId = sessionUserId.value
  if (!initiatingUserId) {
    await loseSession()
    return
  }

  clearActionFeedback()
  leaveCommitted.value = false
  leaveOutcomeUncertain.value = false
  const request = beginAction('leave', initiatingUserId)
  try {
    await $fetch('/api/account/family/leave', {
      method: 'POST',
      signal: request.controller.signal,
      body: {}
    })
    if (!isCurrentAction(request)) return

    confirmingLeave.value = false
    leaveCommitted.value = true
    clearBillingRequest()
    await refreshBilling()
    if (!isCurrentAction(request) || billingError.value) return
  } catch (error) {
    if (!isCurrentAction(request)) return
    if (responseStatus(error) === 401) {
      await loseSession()
      return
    }
    leaveOutcomeUncertain.value = true
    clearBillingRequest()
    await refreshBilling()
  } finally {
    finishAction(request)
  }
}

async function loseSession() {
  if (losingSession) return
  losingSession = true
  resetPrivateState()
  session.value = null
  await navigateTo('/login')
}

function resetPrivateState() {
  actionAbortController?.abort()
  actionAbortController = undefined
  actionRequestGeneration += 1
  clearBillingRequest()
  activeAction.value = ''
  actionError.value = ''
  actionStatus.value = ''
  confirmingLeave.value = false
  leaveCommitted.value = false
  leaveOutcomeUncertain.value = false
}

function beginAction(action: Exclude<BillingAction, ''>, userId: string): ActionRequest {
  actionAbortController?.abort()
  const controller = new AbortController()
  actionAbortController = controller
  const generation = ++actionRequestGeneration
  activeAction.value = action
  return { controller, generation, userId }
}

function isCurrentAction(request: ActionRequest) {
  return (
    !request.controller.signal.aborted &&
    request.generation === actionRequestGeneration &&
    sessionUserId.value === request.userId
  )
}

function finishAction(request: ActionRequest) {
  if (request.generation !== actionRequestGeneration) return
  activeAction.value = ''
  if (actionAbortController === request.controller) actionAbortController = undefined
}

function clearActionFeedback() {
  actionError.value = ''
  actionStatus.value = ''
}

async function focusActionStatus() {
  await nextTick()
  document.getElementById('billing-action-status')?.focus()
}

function isSecureExternalUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function planLabel(plan: BillingPlan) {
  return t(`billing.plans.${plan}`)
}

function cadenceLabel(cadence: BillingCadence) {
  return t(`billing.cadences.${cadence}`)
}

function offeringLabel(plan: BillingPlan, cadence: BillingCadence) {
  return t('billing.offerings.label', {
    plan: planLabel(plan),
    cadence: cadenceLabel(cadence)
  })
}

function offeringCoverage(plan: BillingPlan) {
  return plan === 'family' ? t('billing.offerings.familyCoverage') : t('billing.offerings.personalCoverage')
}

function formatDate(value: string | null) {
  if (!value) return t('billing.facts.notAvailable')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return t('billing.facts.notAvailable')
  return d(date, 'invitationLocal')
}

function transitionDescription(state: BillingAccountState) {
  const transition = state.transition
  if (!transition) return ''
  const target = offeringLabel(
    transition.targetOffering.startsWith('personal.') ? 'personal' : 'family',
    transition.targetOffering.split('.')[1] as BillingCadence
  )
  if (transition.state === 'action_required') {
    return t('billing.transition.actionRequired', { offering: target })
  }
  if (transition.kind === 'personal_to_family') {
    return t('billing.transition.upgradePending', { offering: target })
  }
  return t('billing.transition.scheduled', {
    offering: target,
    date: formatDate(transition.effectiveAt)
  })
}

function presentBillingState(state: BillingAccountState | null): BillingPresentation {
  if (!state) {
    return {
      title: t('billing.shared.unavailableTitle'),
      description: t('billing.presentation.unavailable.description'),
      tone: 'warning'
    }
  }

  if (state.relationship.kind === 'member') {
    if (state.subscription.state === 'reconciliation_required') {
      return {
        title: t('billing.presentation.memberUnavailable.title'),
        description: t('billing.presentation.memberUnavailable.description'),
        tone: 'warning'
      }
    }
    if (state.entitlement.state === 'grace' && state.entitlement.granted) {
      return {
        title: t('billing.shared.membershipActiveTitle'),
        description: t('billing.presentation.memberAtRisk.description'),
        tone: 'warning'
      }
    }
    if (state.entitlement.granted) {
      return {
        title: t('billing.shared.membershipActiveTitle'),
        description: t('billing.shared.includedThroughFamily'),
        tone: 'success'
      }
    }
    return {
      title: t('billing.presentation.memberInactive.title'),
      description: t('billing.presentation.memberInactive.description'),
      tone: 'warning'
    }
  }

  if (state.subscription.checkoutPending) {
    return {
      title: t('billing.presentation.checkoutPending.title'),
      description: t('billing.presentation.checkoutPending.description'),
      tone: 'info'
    }
  }

  switch (state.subscription.state) {
    case 'active':
      return {
        title: t('billing.presentation.active.title', {
          plan: state.subscription.plan ? planLabel(state.subscription.plan) : t('billing.shared.subscription')
        }),
        description: t('billing.presentation.active.description'),
        tone: 'success'
      }
    case 'grace':
      return {
        title: t('billing.presentation.grace.title'),
        description: t('billing.presentation.grace.description', {
          date: formatDate(state.subscription.graceDeadline)
        }),
        tone: 'warning'
      }
    case 'suspended':
      return {
        title: t('billing.presentation.suspended.title'),
        description: t('billing.presentation.suspended.description'),
        tone: 'warning'
      }
    case 'reconciliation_required':
      return {
        title: t('billing.presentation.reconciliation.title'),
        description: t('billing.presentation.reconciliation.description'),
        tone: 'warning'
      }
    case 'terminal':
      return {
        title: t('billing.presentation.terminal.title'),
        description: t('billing.presentation.terminal.description'),
        tone: 'info'
      }
    case 'none':
      return {
        title: t('billing.presentation.none.title'),
        description: t('billing.presentation.none.description'),
        tone: 'info'
      }
  }
}
</script>

<template>
  <AppPage class="billing-page">
    <section class="panel billing-panel" aria-labelledby="billing-page-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('billing.eyebrow') }}</p>
        <h1 id="billing-page-title">{{ t('billing.title') }}</h1>
        <p>{{ t('billing.introduction') }}</p>
      </div>

      <AppStatusMessage v-if="checkoutReturn === 'success'" tone="info">
        {{ t('billing.checkoutReturn.success') }}
      </AppStatusMessage>
      <AppStatusMessage v-else-if="checkoutReturn === 'cancelled'" tone="info">
        {{ t('billing.checkoutReturn.canceled') }}
      </AppStatusMessage>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('billing.shared.unavailableTitle')"
        :description="t('common.sessionVerificationFailed')"
        :action-label="t('common.retry')"
        :busy="sessionStatus === 'pending'"
        @action="refreshSession()"
      />
      <UiStateBlock
        v-else-if="billingPending || billingStatus === 'idle'"
        tone="loading"
        :title="t('billing.loading.title')"
        :description="t('billing.loading.description')"
      />
      <UiStateBlock
        v-else-if="billingError"
        tone="error"
        :title="t('billing.shared.unavailableTitle')"
        :description="
          leaveCommitted
            ? t('billing.loadError.afterLeave')
            : leaveOutcomeUncertain
              ? t('billing.loadError.uncertainLeave')
              : t('billing.loadError.general')
        "
        :action-label="t('common.retry')"
        :busy="billingPending"
        @action="refreshBilling()"
      />

      <div v-else-if="billingState" class="billing-content">
        <section class="billing-summary" aria-labelledby="billing-summary-title">
          <div>
            <p class="eyebrow">
              {{ isMember ? t('billing.summary.membershipEyebrow') : t('billing.summary.subscriptionEyebrow') }}
            </p>
            <h2 id="billing-summary-title">
              {{
                isMember
                  ? t('billing.summary.membershipTitle')
                  : billingState.subscription.plan
                    ? offeringLabel(billingState.subscription.plan, billingState.subscription.cadence!)
                    : t('billing.summary.subscriptionTitle')
              }}
            </h2>
          </div>

          <AppStatusMessage :tone="statusPresentation.tone">
            <strong>{{ statusPresentation.title }}</strong>
            <span>{{ statusPresentation.description }}</span>
          </AppStatusMessage>

          <AppStatusMessage v-if="billingState.transition" tone="info">
            <strong>{{ t('billing.transition.title') }}</strong>
            <span>{{ transitionDescription(billingState) }}</span>
          </AppStatusMessage>

          <dl class="billing-facts">
            <div>
              <dt>{{ t('billing.facts.access') }}</dt>
              <dd>
                {{ billingState.entitlement.granted ? t('billing.facts.available') : t('billing.facts.notAvailable') }}
              </dd>
            </div>
            <div>
              <dt>{{ t('billing.facts.relationship') }}</dt>
              <dd>{{ t(`billing.relationships.${billingState.relationship.kind}`) }}</dd>
            </div>
            <div v-if="!isMember">
              <dt>{{ t('billing.facts.provider') }}</dt>
              <dd>{{ billingState.subscription.provider }}</dd>
            </div>
            <div v-if="billingState.subscription.cadence">
              <dt>{{ t('billing.facts.cadence') }}</dt>
              <dd>{{ cadenceLabel(billingState.subscription.cadence) }}</dd>
            </div>
            <div v-if="!isMember && billingState.subscription.currentPeriodEnd">
              <dt>{{ t('billing.facts.periodEnd') }}</dt>
              <dd>{{ formatDate(billingState.subscription.currentPeriodEnd) }}</dd>
            </div>
            <div v-if="!isMember && billingState.subscription.plan">
              <dt>{{ t('billing.facts.renewal') }}</dt>
              <dd>
                {{
                  billingState.subscription.renewalEnabled
                    ? t('billing.facts.renewalOn')
                    : t('billing.facts.renewalOff')
                }}
              </dd>
            </div>
            <div v-if="billingState.seats">
              <dt>{{ t('billing.facts.acceptedSeats') }}</dt>
              <dd>
                {{
                  t('billing.facts.seatValue', {
                    count: billingState.seats.accepted,
                    capacity: billingState.seats.capacity
                  })
                }}
              </dd>
            </div>
            <div v-if="billingState.seats">
              <dt>{{ t('billing.facts.reservedSeats') }}</dt>
              <dd>{{ billingState.seats.reserved }}</dd>
            </div>
          </dl>

          <p class="privacy-note">{{ t('billing.privacyNote') }}</p>

          <AppStatusMessage v-if="actionError" id="billing-action-status" tabindex="-1" tone="error">
            {{ actionError }}
          </AppStatusMessage>
          <AppStatusMessage v-else-if="actionStatus" id="billing-action-status" tabindex="-1" tone="success">
            {{ actionStatus }}
          </AppStatusMessage>

          <div v-if="!isMember" class="billing-actions">
            <button
              v-if="billingState.capabilities.canManage"
              class="secondary-button"
              type="button"
              :disabled="isBusy"
              @click="openBillingPortal"
            >
              {{ activeAction === 'portal' ? t('billing.actions.openingBilling') : t('billing.actions.manageBilling') }}
            </button>
            <button
              v-if="
                billingState.capabilities.canReconcile &&
                (billingState.subscription.checkoutPending ||
                  billingState.subscription.state === 'reconciliation_required' ||
                  billingState.transition?.state === 'reconciliation_required')
              "
              class="secondary-button"
              type="button"
              :disabled="isBusy"
              @click="reconcileBilling"
            >
              {{
                activeAction === 'reconcile' ? t('billing.actions.checkingStatus') : t('billing.actions.checkStatus')
              }}
            </button>
          </div>

          <div v-else class="member-actions">
            <p>{{ t('billing.actions.memberExplanation') }}</p>
            <button
              v-if="billingState.capabilities.canLeaveFamily && !confirmingLeave"
              ref="leaveTrigger"
              class="secondary-button"
              type="button"
              :disabled="isBusy"
              @click="revealLeaveConfirmation"
            >
              {{ t('billing.actions.leave') }}
            </button>
            <div v-else-if="confirmingLeave" class="leave-confirmation" role="group" aria-labelledby="leave-title">
              <div>
                <h3 id="leave-title">{{ t('billing.actions.leaveTitle') }}</h3>
                <p>{{ t('billing.actions.leaveDescription') }}</p>
              </div>
              <div class="billing-actions">
                <button
                  ref="leaveConfirmation"
                  class="primary-button"
                  type="button"
                  :disabled="isBusy"
                  @click="leaveFamilyMembership"
                >
                  {{ activeAction === 'leave' ? t('billing.actions.leaving') : t('billing.actions.confirmLeave') }}
                </button>
                <button class="secondary-button" type="button" :disabled="isBusy" @click="cancelLeave">
                  {{ t('billing.actions.keepMembership') }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="checkoutOfferings.length" class="offering-section" aria-labelledby="available-offerings-title">
          <div>
            <h2 id="available-offerings-title">{{ t('billing.offerings.availableTitle') }}</h2>
            <p>{{ t('billing.offerings.availableDescription') }}</p>
          </div>
          <ul class="offering-list">
            <li v-for="offering in checkoutOfferings" :key="offering.key" class="offering-card">
              <div>
                <h3>{{ offeringLabel(offering.plan, offering.cadence) }}</h3>
                <p>{{ offeringCoverage(offering.plan) }}</p>
              </div>
              <button class="primary-button" type="button" :disabled="isBusy" @click="startCheckout(offering.key)">
                {{
                  activeAction === `checkout:${offering.key}`
                    ? t('billing.actions.openingCheckout')
                    : t('billing.actions.chooseOffering', {
                        offering: offeringLabel(offering.plan, offering.cadence)
                      })
                }}
              </button>
            </li>
          </ul>
        </section>

        <section v-if="changeOfferings.length" class="offering-section" aria-labelledby="change-offerings-title">
          <div>
            <h2 id="change-offerings-title">{{ t('billing.offerings.changeTitle') }}</h2>
            <p>{{ t('billing.offerings.changeDescription') }}</p>
          </div>
          <ul class="offering-list">
            <li v-for="offering in changeOfferings" :key="offering.key" class="offering-card">
              <div>
                <h3>{{ offeringLabel(offering.plan, offering.cadence) }}</h3>
                <p>{{ offeringCoverage(offering.plan) }}</p>
              </div>
              <button class="secondary-button" type="button" :disabled="isBusy" @click="changeOffering(offering.key)">
                {{
                  activeAction === `change:${offering.key}`
                    ? t('billing.actions.changing')
                    : t('billing.actions.changeOffering', {
                        offering: offeringLabel(offering.plan, offering.cadence)
                      })
                }}
              </button>
            </li>
          </ul>
        </section>

        <NuxtLink class="secondary-button account-return" to="/account">
          {{ t('billing.actions.returnToAccount') }}
        </NuxtLink>
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .billing-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .billing-panel,
  .billing-content,
  .billing-summary,
  .billing-facts,
  .member-actions,
  .leave-confirmation,
  .offering-section,
  .offering-list,
  .offering-card {
    display: grid;
    min-width: 0;
    gap: var(--space-4);
  }

  .billing-panel {
    width: min(100%, 760px);
    padding: var(--space-5);
  }

  .member-actions > p,
  .leave-confirmation p,
  .privacy-note,
  .offering-card p,
  .offering-section > div > p,
  .panel-heading > p:last-child {
    margin: 0;
    color: var(--color-text-muted);
  }

  .billing-summary h2,
  .leave-confirmation h3,
  .offering-section h2,
  .offering-card h3 {
    margin: 0;
  }

  .billing-summary .status-message {
    display: grid;
    gap: var(--space-1);
  }

  .billing-facts {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0;
  }

  .billing-facts div {
    min-width: 0;
    border-top: var(--border-width) solid var(--color-border);
    padding-top: var(--space-3);
  }

  .billing-facts dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .billing-facts dd {
    overflow-wrap: anywhere;
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-strong);
  }

  .billing-actions {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .member-actions > .secondary-button,
  .account-return {
    width: fit-content;
  }

  .leave-confirmation,
  .offering-card {
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    background: var(--color-canvas);
  }

  .offering-section {
    border-top: var(--border-width) solid var(--color-border);
    padding-top: var(--space-4);
  }

  .offering-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .offering-card {
    align-content: space-between;
  }

  .offering-card > div {
    display: grid;
    gap: var(--space-1);
  }

  .offering-card .primary-button,
  .offering-card .secondary-button {
    width: 100%;
  }

  @media (width <= 620px) {
    .billing-facts,
    .offering-list {
      grid-template-columns: 1fr;
    }

    .billing-actions {
      display: grid;
    }

    .billing-actions > *,
    .member-actions > .secondary-button,
    .account-return {
      width: 100%;
    }
  }
}
</style>
