<script setup lang="ts">
import type { MembershipConnectionKind } from '#server/db/schema/membership'
import { isPublicJoinAttemptId, publicJoinCompletionCallback, type PublicJoinStatusResponse } from '#shared/join'

const route = useRoute()
const { t } = useI18n()
const { data: session } = await useAppSession()
const rawAttemptId = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id
const requestedAttemptId = isPublicJoinAttemptId(rawAttemptId) ? rawAttemptId : null
const responseCacheControl = useResponseHeader('cache-control')
responseCacheControl.value = 'private, no-store'

const {
  data: joinStatus,
  error: statusError,
  status: requestStatus,
  refresh
} = await useFetch<PublicJoinStatusResponse>('/api/join/status', {
  key: `public-join-status-${requestedAttemptId ?? 'account'}`,
  query: requestedAttemptId ? { id: requestedAttemptId } : undefined
})

const connectionKind = ref<MembershipConnectionKind | ''>('')
const conductAccepted = ref(false)
const submitting = ref(false)
const formError = ref('')
const attestationForm = ref<HTMLFormElement | null>(null)
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollsRemaining = 20
let accountClaimAttempted = false

const attemptId = computed(() => joinStatus.value?.attemptId ?? requestedAttemptId)
const status = computed(() => joinStatus.value?.status ?? 'processing')
const amount = computed(() => (joinStatus.value?.offering === 'family.monthly' ? 27 : 10))
const signInReturnTo = computed(() => (attemptId.value ? publicJoinCompletionCallback(attemptId.value) : '/join'))
const connectionOptions = computed(() => [
  {
    value: 'resides',
    title: t('join.complete.connection.resides'),
    description: t('join.complete.connection.residesDescription')
  },
  {
    value: 'works',
    title: t('join.complete.connection.works'),
    description: t('join.complete.connection.worksDescription')
  },
  {
    value: 'studies',
    title: t('join.complete.connection.studies'),
    description: t('join.complete.connection.studiesDescription')
  },
  {
    value: 'worships',
    title: t('join.complete.connection.worships'),
    description: t('join.complete.connection.worshipsDescription')
  }
])

useHead(() => ({
  title: t('join.complete.pageTitle'),
  meta: [
    { name: 'description', content: t('join.complete.description') },
    { name: 'referrer', content: 'no-referrer' }
  ]
}))

onMounted(() => {
  schedulePoll()
  void tryAccountClaim()
})
onBeforeUnmount(clearPoll)

watch([status, () => session.value?.user?.id], () => {
  schedulePoll()
  void tryAccountClaim()
})

function schedulePoll() {
  clearPoll()
  if (status.value !== 'processing' || pollsRemaining <= 0) return
  pollTimer = setTimeout(async () => {
    pollsRemaining -= 1
    await refresh()
    schedulePoll()
  }, 2_500)
}

function clearPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function retryStatus() {
  pollsRemaining = 20
  await refresh()
  schedulePoll()
}

async function tryAccountClaim() {
  if (
    !import.meta.client ||
    accountClaimAttempted ||
    status.value !== 'check_email' ||
    !session.value?.user ||
    !attemptId.value
  ) {
    return
  }

  accountClaimAttempted = true
  try {
    const result = await $fetch<{ outcome: 'active' | 'claimed' | 'conflict' | 'expired' | 'ignored' }>(
      '/api/join/claim-account',
      { method: 'POST', body: { attemptId: attemptId.value } }
    )
    if ((result.outcome === 'conflict' || result.outcome === 'expired') && joinStatus.value) {
      joinStatus.value = { ...joinStatus.value, status: 'review' }
    } else if (result.outcome === 'active' || result.outcome === 'claimed') {
      await refresh()
    }
  } catch {
    // The emailed claim link and fresh-link recovery remain available.
  }
}

async function activateMembership() {
  formError.value = ''
  if (!connectionKind.value || !conductAccepted.value) {
    formError.value = t('join.complete.attestationRequired')
    await nextTick()
    const selector = !connectionKind.value ? '[role="radio"]' : 'input[name="conduct-accepted"]'
    attestationForm.value?.querySelector<HTMLElement>(selector)?.focus()
    return
  }
  if (!attemptId.value || submitting.value) return

  submitting.value = true
  try {
    await $fetch('/api/join/activate', {
      method: 'POST',
      body: {
        attemptId: attemptId.value,
        connectionKind: connectionKind.value,
        codeOfConductAccepted: true
      }
    })
    await refresh()
  } catch {
    formError.value = t('join.complete.activationError')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <article class="join-complete" aria-labelledby="join-complete-title">
    <header class="complete-heading">
      <p class="complete-eyebrow">{{ t('join.complete.eyebrow') }}</p>
      <h1 id="join-complete-title">{{ t('join.complete.title') }}</h1>
      <p>{{ t('join.complete.description') }}</p>
    </header>

    <AppNotice v-if="route.query.status === 'link-error'" tone="error" :title="t('join.complete.linkErrorTitle')">
      {{ t('join.complete.linkError') }}
    </AppNotice>

    <AppNotice v-if="statusError" tone="error" :title="t('join.complete.statusErrorTitle')">
      <p>{{ t('join.complete.statusError') }}</p>
      <AppButton variant="secondary" size="compact" @click="retryStatus">{{ t('common.retry') }}</AppButton>
    </AppNotice>

    <section v-else-if="requestStatus === 'pending' || status === 'processing'" class="complete-panel">
      <div class="complete-icon" aria-hidden="true">•••</div>
      <h2>{{ t('join.complete.processingTitle') }}</h2>
      <p>{{ t('join.complete.processing') }}</p>
      <AppButton variant="secondary" @click="retryStatus">{{ t('join.complete.checkAgain') }}</AppButton>
    </section>

    <section v-else-if="status === 'check_email'" class="complete-panel">
      <div class="complete-icon" aria-hidden="true">✉</div>
      <h2>{{ t('join.complete.emailTitle') }}</h2>
      <p>{{ t('join.complete.email', { amount }) }}</p>
      <p>{{ t('join.complete.emailSafety') }}</p>
      <p class="complete-login">
        {{ t('join.complete.expiredLink') }}
        <NuxtLink :to="{ path: '/login', query: { returnTo: signInReturnTo } }">
          {{ t('join.complete.freshLink') }}
        </NuxtLink>
      </p>
    </section>

    <section v-else-if="status === 'review'" class="complete-panel">
      <div class="complete-icon" aria-hidden="true">!</div>
      <h2>{{ t('join.complete.reviewTitle') }}</h2>
      <p>{{ t('join.complete.review') }}</p>
      <a href="mailto:info@workingclassunity.com">info@workingclassunity.com</a>
    </section>

    <form
      v-else-if="status === 'needs_attestation'"
      ref="attestationForm"
      class="complete-panel attestation-form"
      novalidate
      @submit.prevent="activateMembership"
    >
      <div>
        <h2>{{ t('join.complete.attestationTitle') }}</h2>
        <p>{{ t('join.complete.attestationDescription') }}</p>
      </div>

      <fieldset>
        <legend>{{ t('join.complete.connection.legend') }}</legend>
        <JoinOptionGroup
          v-model="connectionKind"
          :label="t('join.complete.connection.legend')"
          :options="connectionOptions"
          :disabled="submitting"
        />
      </fieldset>

      <label class="conduct-check">
        <input v-model="conductAccepted" type="checkbox" name="conduct-accepted" :disabled="submitting" />
        <span>
          {{ t('join.complete.conductPrefix') }}
          <a
            href="https://chat.workingclassunity.com/docs?topic=186#article-vi-prohibited-behavior-22"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('join.complete.conductLink') }}</a
          >.
        </span>
      </label>

      <AppNotice v-if="formError" tone="error" announce="assertive">{{ formError }}</AppNotice>
      <AppButton type="submit" :pending="submitting">{{ t('join.complete.activate') }}</AppButton>
    </form>

    <section v-else-if="status === 'active'" class="complete-panel">
      <div class="complete-icon complete-icon--success" aria-hidden="true">✓</div>
      <h2>{{ t('join.complete.activeTitle') }}</h2>
      <p>{{ t('join.complete.active') }}</p>
      <NuxtLink class="complete-action" to="/account">{{ t('join.complete.account') }}</NuxtLink>
    </section>

    <section v-else class="complete-panel">
      <div class="complete-icon" aria-hidden="true">×</div>
      <h2>{{ t('join.complete.failedTitle') }}</h2>
      <p>{{ t('join.complete.failed') }}</p>
      <NuxtLink class="complete-action" to="/join">{{ t('join.complete.tryAgain') }}</NuxtLink>
    </section>
  </article>
</template>

<style scoped>
@layer components {
  .join-complete {
    display: grid;
    gap: var(--space-5);
    max-inline-size: 58rem;
    margin-inline: auto;
    padding-block: var(--space-5) var(--space-7);
  }

  .complete-heading,
  .complete-panel,
  .attestation-form,
  .attestation-form > div {
    display: grid;
    gap: var(--space-3);
  }

  .complete-heading {
    text-align: center;
  }

  .complete-heading p,
  .complete-heading h1,
  .complete-panel h2,
  .complete-panel p {
    margin: 0;
  }

  .complete-eyebrow {
    color: var(--color-accent-action);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .complete-heading h1 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(2.5rem, 1.9rem + 2vw, 4rem);
    letter-spacing: -0.05em;
    line-height: 1;
  }

  .complete-heading > :last-child {
    color: var(--color-text-muted);
    font-size: 1.1rem;
    line-height: 1.55;
  }

  .complete-panel {
    justify-items: center;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: clamp(var(--space-4), 5vw, var(--space-6));
    background: var(--color-surface);
    text-align: center;
  }

  .complete-panel > p {
    max-inline-size: 58ch;
    color: var(--color-text-muted);
    line-height: 1.55;
  }

  .complete-panel h2 {
    color: var(--color-brand-primary);
    font-family: var(--font-family-display);
    font-size: clamp(1.65rem, 1.4rem + 0.7vw, 2.2rem);
    letter-spacing: -0.035em;
  }

  .complete-icon {
    display: grid;
    place-items: center;
    inline-size: 3.5rem;
    block-size: 3.5rem;
    border-radius: 50%;
    color: var(--color-action-contrast);
    background: var(--color-brand-primary);
    font-size: 1.5rem;
    font-weight: var(--font-weight-heavy);
    letter-spacing: 0.08em;
  }

  .complete-icon--success {
    background: var(--color-status-success-text);
  }

  .complete-panel > .complete-login {
    margin-block-start: var(--space-2);
  }

  .attestation-form {
    justify-items: stretch;
    text-align: start;
  }

  .attestation-form fieldset {
    min-width: 0;
    padding: 0;
    border: 0;
    margin: 0;
  }

  .attestation-form legend {
    margin-block-end: var(--space-3);
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .conduct-check {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    line-height: 1.55;
    cursor: pointer;
  }

  .conduct-check input {
    inline-size: 1.25rem;
    block-size: 1.25rem;
    margin-block-start: 0.1rem;
  }

  .attestation-form :deep(.app-button) {
    inline-size: 100%;
  }

  .complete-action {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    justify-content: center;
    border: var(--border-width) solid var(--color-action);
    border-radius: var(--radius-2);
    padding-inline: var(--space-4);
    color: var(--color-action-contrast);
    background: var(--color-action);
    font-weight: var(--font-weight-bold);
    text-decoration: none;
  }

  @media (width <= 36rem) {
    .join-complete {
      padding-block-start: var(--space-3);
    }

    .complete-panel {
      padding: var(--space-4);
    }
  }
}
</style>
