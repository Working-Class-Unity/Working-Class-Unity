<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

type AppInputHandle = {
  focus: () => void
  isValid: () => boolean
}

const props = defineProps<{
  email: string | null
  emailVerified: boolean
}>()

const { t } = useI18n()
const newEmail = ref('')
const emailInput = ref<AppInputHandle | null>(null)
const fieldError = ref('')
const formError = ref('')
const formSuccess = ref('')
const isSubmitting = ref(false)

watch(newEmail, () => {
  fieldError.value = ''
  formError.value = ''
  formSuccess.value = ''
})

async function requestEmailVerification() {
  if (isSubmitting.value) return

  fieldError.value = ''
  formError.value = ''
  formSuccess.value = ''

  const normalizedEmail = newEmail.value.trim().toLowerCase()
  if (!normalizedEmail) {
    fieldError.value = t('account.email.required')
  } else if (!emailInput.value?.isValid()) {
    fieldError.value = t('common.emailInvalid')
  } else if (normalizedEmail === props.email?.toLowerCase()) {
    fieldError.value = t('account.email.unchanged')
  }

  if (fieldError.value) {
    await nextTick()
    emailInput.value?.focus()
    return
  }

  isSubmitting.value = true
  try {
    const result = await authClient.changeEmail({ newEmail: normalizedEmail, callbackURL: '/account' })
    if (result.error) {
      formError.value = t('account.email.requestError')
      return
    }
    newEmail.value = ''
    formSuccess.value = t('account.email.requested')
  } catch {
    formError.value = t('account.email.requestError')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section class="account-section email-section" aria-labelledby="email-settings-title">
    <div>
      <h2 id="email-settings-title">{{ t('account.email.title') }}</h2>
      <p>{{ t('account.email.description') }}</p>
    </div>

    <dl class="current-email">
      <div>
        <dt>{{ t('account.email.current') }}</dt>
        <dd>{{ props.email ?? t('account.identity.notAdded') }}</dd>
      </div>
      <div>
        <dt>{{ t('account.email.status') }}</dt>
        <dd>{{ props.emailVerified ? t('account.email.verified') : t('account.email.notVerified') }}</dd>
      </div>
    </dl>

    <form class="email-form" novalidate @submit.prevent="requestEmailVerification">
      <AppField
        id="account-email"
        :label="props.email ? t('account.email.newEmail') : t('account.email.addEmail')"
        :hint="t('account.email.help')"
        :error="fieldError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <AppInput
            :id="id"
            ref="emailInput"
            v-model="newEmail"
            name="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            :required="required"
            :disabled="isSubmitting"
          />
        </template>
      </AppField>

      <AppNotice v-if="formError" tone="error" announce="assertive">{{ formError }}</AppNotice>
      <AppNotice v-else-if="formSuccess" tone="success" announce="polite">{{ formSuccess }}</AppNotice>

      <AppButton class="email-submit" type="submit" :pending="isSubmitting">
        {{ isSubmitting ? t('account.email.sending') : t('account.email.send') }}
      </AppButton>
    </form>
  </section>
</template>

<style scoped>
@layer components {
  .email-section,
  .email-form {
    display: grid;
    gap: var(--space-3);
  }

  .current-email {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .current-email div {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    background: var(--color-surface);
  }

  .current-email dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .current-email dd {
    overflow-wrap: anywhere;
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-strong);
  }

  .email-submit {
    width: fit-content;
  }

  @media (width <= 620px) {
    .current-email {
      grid-template-columns: 1fr;
    }

    .email-submit {
      width: 100%;
    }
  }
}
</style>
