<script setup lang="ts">
const emit = defineEmits<{
  deleted: []
}>()

const { t } = useI18n()
const deletionConfirmation = 'DELETE'
const confirmation = ref('')
const deletionError = ref('')
const isDeleting = ref(false)
const confirmationMatches = computed(() => confirmation.value === deletionConfirmation)

async function deleteAccount() {
  if (!confirmationMatches.value || isDeleting.value) return

  deletionError.value = ''
  isDeleting.value = true

  try {
    const result = await $fetch<{ success?: boolean; message?: string }>('/api/account', {
      method: 'DELETE',
      body: { confirmation: deletionConfirmation }
    })
    if (result.success !== true || result.message !== 'User deleted') {
      throw new Error('Unexpected account-deletion response')
    }
  } catch (error) {
    deletionError.value = isFreshSessionError(error)
      ? t('account.deletion.sessionTooOld')
      : isAccountDeletionBillingPendingError(error)
        ? t('account.deletion.billingPending')
        : t('account.deletion.unknownResult')
    return
  } finally {
    isDeleting.value = false
  }

  emit('deleted')
  await navigateTo('/login')
}

function isFreshSessionError(error: unknown) {
  return errorValues(error).some((value) => typeof value === 'string' && /SESSION_(?:EXPIRED|NOT_FRESH)/.test(value))
}

function isAccountDeletionBillingPendingError(error: unknown) {
  return errorValues(error).includes('ACCOUNT_DELETION_BILLING_PENDING')
}

function errorValues(error: unknown): unknown[] {
  if (!error || typeof error !== 'object') return []
  const candidate = error as {
    data?: { code?: unknown; message?: unknown; statusMessage?: unknown }
    message?: unknown
  }
  return [candidate.data?.code, candidate.data?.message, candidate.data?.statusMessage, candidate.message]
}
</script>

<template>
  <section class="account-section destructive-section" aria-labelledby="delete-account-title">
    <div>
      <h2 id="delete-account-title">{{ t('account.deletion.title') }}</h2>
      <p>{{ t('account.deletion.description') }}</p>
      <p>{{ t('account.deletion.billingWarning') }}</p>
    </div>

    <AppNotice v-if="deletionError" tone="error" announce="assertive">{{ deletionError }}</AppNotice>

    <form class="deletion-form" @submit.prevent="deleteAccount">
      <AppField
        id="delete-account-confirmation"
        :label="t('account.deletion.confirmationLabel', { confirmation: deletionConfirmation })"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, required }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
            :id="id"
            v-model="confirmation"
            name="confirmation"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :aria-describedby="[describedBy, 'delete-account-help'].filter(Boolean).join(' ')"
            :required="required"
            :disabled="isDeleting"
          />
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>
      <p id="delete-account-help" class="deletion-help">{{ t('account.deletion.help') }}</p>
      <AppButton
        class="deletion-button"
        type="submit"
        variant="danger"
        :disabled="!confirmationMatches"
        :pending="isDeleting"
      >
        {{ isDeleting ? t('account.deletion.deleting') : t('account.deletion.submit') }}
      </AppButton>
    </form>
  </section>
</template>

<style scoped>
@layer components {
  .destructive-section,
  .deletion-form {
    display: grid;
    gap: var(--space-3);
  }

  .destructive-section {
    border: var(--border-width) solid var(--color-status-error-text);
    border-radius: var(--radius-2);
    padding: var(--space-4);
    background: var(--color-status-error-surface);
  }

  .destructive-section p {
    color: var(--color-text);
  }

  .deletion-help {
    margin: 0;
    color: var(--color-status-error-text);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-strong);
  }

  .deletion-button {
    width: fit-content;
  }

  @media (width <= 620px) {
    .deletion-button {
      width: 100%;
    }
  }
}
</style>
