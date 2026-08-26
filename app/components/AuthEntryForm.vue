<script setup lang="ts">
import { resolveAuthCallbacks, type AuthEntryIntent } from '#shared/auth-routes'
import { turnstileActions, turnstileHeaderName } from '#shared/turnstile'
import { authClient } from '~/lib/auth-client'

type TurnstileChallengeHandle = {
  reset: () => void
}

type AppInputHandle = {
  focus: () => void
  isValid: () => boolean
}

type AuthMethod = 'email' | 'phone'
type PhoneStep = 'number' | 'code'

const props = defineProps<{
  intent: AuthEntryIntent
  sessionError?: string
}>()

const route = useRoute()
const { t } = useI18n()
const method = ref<AuthMethod>('email')
const phoneStep = ref<PhoneStep>('number')
const email = ref('')
const phoneNumber = ref('')
const verificationPhoneNumber = ref('')
const verificationCode = ref('')
const emailInput = ref<AppInputHandle | null>(null)
const phoneInput = ref<AppInputHandle | null>(null)
const codeInput = ref<AppInputHandle | null>(null)
const turnstileChallenge = ref<TurnstileChallengeHandle | null>(null)
const turnstileToken = ref('')
const fieldError = ref('')
const formError = ref(route.query.error === undefined ? '' : t('auth.errors.authenticationFailed'))
const formSuccess = ref(
  route.query.status === 'signed-out'
    ? t('auth.status.signedOut')
    : route.query.status === 'billing-email-checked'
      ? t('auth.status.billingEmailChecked')
      : ''
)
const isSubmitting = ref(false)

const copy = computed(() =>
  props.intent === 'login'
    ? {
        eyebrow: t('auth.login.eyebrow'),
        title: t('auth.login.title'),
        intro: t('auth.login.introduction')
      }
    : {
        eyebrow: t('auth.signup.eyebrow'),
        title: t('auth.signup.title'),
        intro: t('auth.signup.introduction')
      }
)
const callbacks = computed(() => resolveAuthCallbacks(props.intent))
const inputId = computed(() =>
  method.value === 'email' ? `${props.intent}-email` : `${props.intent}-phone-${phoneStep.value}`
)
const formStatusId = computed(() => `${props.intent}-form-status`)
const requiresTurnstile = computed(() => method.value === 'email' || phoneStep.value === 'number')
const turnstileAction = computed(() =>
  method.value === 'email' ? turnstileActions.magicLink : turnstileActions.phoneOtp
)
const submitLabel = computed(() => {
  if (method.value === 'email') return isSubmitting.value ? t('auth.email.sending') : t('auth.email.submit')
  if (phoneStep.value === 'number') return isSubmitting.value ? t('auth.phone.sending') : t('auth.phone.send')
  return isSubmitting.value ? t('auth.phone.verifying') : t('auth.phone.verify')
})

watch([email, phoneNumber, verificationCode], () => {
  fieldError.value = ''
})

function chooseMethod(nextMethod: AuthMethod) {
  if (isSubmitting.value || method.value === nextMethod) return
  method.value = nextMethod
  phoneStep.value = 'number'
  verificationCode.value = ''
  verificationPhoneNumber.value = ''
  clearStatus()
  nextTick(() => (nextMethod === 'email' ? emailInput.value?.focus() : phoneInput.value?.focus()))
}

function editPhoneNumber() {
  if (isSubmitting.value) return
  phoneStep.value = 'number'
  verificationCode.value = ''
  verificationPhoneNumber.value = ''
  clearStatus()
  nextTick(() => phoneInput.value?.focus())
}

function clearStatus() {
  formError.value = ''
  formSuccess.value = ''
  fieldError.value = ''
  turnstileToken.value = ''
}

async function submitAuth() {
  formError.value = ''
  formSuccess.value = ''
  fieldError.value = ''

  if (!validateAuthForm()) {
    formError.value = t('auth.errors.formInvalid')
    await focusFirstInvalidControl()
    return
  }

  if (requiresTurnstile.value && !turnstileToken.value) {
    formError.value = t('auth.errors.securityRequired')
    return
  }

  isSubmitting.value = true

  try {
    if (method.value === 'email') {
      await submitEmail()
    } else if (phoneStep.value === 'number') {
      await sendPhoneCode()
    } else {
      await verifyPhoneCode()
    }
  } catch {
    formError.value = method.value === 'email' ? t('auth.errors.emailLink') : t('auth.errors.phoneUnavailable')
  } finally {
    if (requiresTurnstile.value) turnstileChallenge.value?.reset()
    isSubmitting.value = false
  }
}

async function submitEmail() {
  const result = await authClient.signIn.magicLink(
    { email: email.value, ...callbacks.value },
    { headers: { [turnstileHeaderName]: turnstileToken.value } }
  )
  if (result.error) {
    formError.value = t('auth.errors.emailLink')
    return
  }
  formSuccess.value = t('auth.status.emailLinkSent')
  email.value = ''
}

async function sendPhoneCode() {
  const result = await authClient.phoneNumber.sendOtp(
    { phoneNumber: phoneNumber.value },
    { headers: { [turnstileHeaderName]: turnstileToken.value } }
  )
  if (result.error) {
    formError.value = t('auth.errors.phoneCode')
    return
  }
  verificationPhoneNumber.value = phoneNumber.value.trim()
  phoneStep.value = 'code'
  formSuccess.value = t('auth.status.phoneCodeSent')
  await nextTick()
  codeInput.value?.focus()
}

async function verifyPhoneCode() {
  const result = await authClient.phoneNumber.verify({
    phoneNumber: verificationPhoneNumber.value,
    code: verificationCode.value
  })
  if (result.error || !result.data?.status) {
    formError.value = t('auth.errors.phoneVerification')
    return
  }
  await navigateTo('/app')
}

async function focusFirstInvalidControl() {
  await nextTick()
  if (method.value === 'email') emailInput.value?.focus()
  else if (phoneStep.value === 'number') phoneInput.value?.focus()
  else codeInput.value?.focus()
}

function validateAuthForm() {
  if (method.value === 'email' && !email.value.trim()) {
    fieldError.value = t('auth.email.required')
  } else if (method.value === 'email' && emailInput.value && !emailInput.value.isValid()) {
    fieldError.value = t('common.emailInvalid')
  } else if (method.value === 'phone' && phoneStep.value === 'number' && !phoneNumber.value.trim()) {
    fieldError.value = t('auth.phone.required')
  } else if (method.value === 'phone' && phoneStep.value === 'number' && !phoneInput.value?.isValid()) {
    fieldError.value = t('auth.phone.invalid')
  } else if (method.value === 'phone' && phoneStep.value === 'code' && !verificationCode.value.trim()) {
    fieldError.value = t('auth.phone.codeRequired')
  } else if (method.value === 'phone' && phoneStep.value === 'code' && !codeInput.value?.isValid()) {
    fieldError.value = t('auth.phone.codeInvalid')
  }

  return !fieldError.value
}
</script>

<template>
  <section class="auth-entry-panel" :aria-labelledby="`${intent}-title`">
    <div class="panel-heading">
      <p class="eyebrow">{{ copy.eyebrow }}</p>
      <h1 :id="`${intent}-title`">{{ copy.title }}</h1>
      <p class="auth-intro">{{ copy.intro }}</p>
    </div>

    <div class="auth-methods" role="group" :aria-label="t('auth.method.label')">
      <AppButton
        variant="secondary"
        :aria-pressed="method === 'email' ? 'true' : 'false'"
        :disabled="isSubmitting"
        @click="chooseMethod('email')"
      >
        {{ t('auth.method.email') }}
      </AppButton>
      <AppButton
        variant="secondary"
        :aria-pressed="method === 'phone' ? 'true' : 'false'"
        :disabled="isSubmitting"
        @click="chooseMethod('phone')"
      >
        {{ t('auth.method.phone') }}
      </AppButton>
    </div>

    <AppNotice v-if="sessionError" tone="error" :title="t('auth.sessionUnavailable.title')">
      <p>{{ t('auth.sessionUnavailable.description') }}</p>
    </AppNotice>

    <form
      class="auth-form"
      :aria-describedby="formError || formSuccess ? `${formStatusId} auth-legal` : 'auth-legal'"
      novalidate
      @submit.prevent="submitAuth"
    >
      <AppField
        v-if="method === 'email'"
        :id="inputId"
        :label="t('common.email')"
        :error="fieldError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <AppInput
            :id="id"
            ref="emailInput"
            v-model.trim="email"
            name="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            :required="required"
          />
        </template>
      </AppField>

      <AppField
        v-else-if="phoneStep === 'number'"
        :id="inputId"
        :label="t('auth.phone.label')"
        :error="fieldError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <AppInput
            :id="id"
            ref="phoneInput"
            v-model.trim="phoneNumber"
            name="phone-number"
            type="tel"
            autocomplete="tel"
            inputmode="tel"
            pattern="[+0-9() -]{10,20}"
            placeholder="(209) 555-0123"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            :required="required"
          />
        </template>
      </AppField>

      <AppField
        v-else
        :id="inputId"
        :label="t('auth.phone.codeLabel')"
        :error="fieldError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <AppInput
            :id="id"
            ref="codeInput"
            v-model.trim="verificationCode"
            name="verification-code"
            type="text"
            autocomplete="one-time-code"
            inputmode="numeric"
            pattern="[0-9]{4,10}"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            :required="required"
          />
        </template>
      </AppField>

      <p v-if="method === 'phone'" class="phone-help">
        {{
          phoneStep === 'number' ? t('auth.phone.help') : t('auth.phone.codeHelp', { phone: verificationPhoneNumber })
        }}
      </p>
      <AppButton
        v-if="method === 'phone' && phoneStep === 'code'"
        class="edit-phone"
        variant="secondary"
        size="compact"
        :disabled="isSubmitting"
        @click="editPhoneNumber"
      >
        {{ t('auth.phone.change') }}
      </AppButton>

      <TurnstileChallenge
        v-if="requiresTurnstile"
        :key="`${method}-${phoneStep}`"
        ref="turnstileChallenge"
        v-model="turnstileToken"
        :action="turnstileAction"
      />

      <AppNotice v-if="formError" :id="formStatusId" tone="error" announce="assertive">
        {{ formError }}
      </AppNotice>
      <AppNotice v-else-if="formSuccess" :id="formStatusId" tone="success" announce="polite">
        {{ formSuccess }}
      </AppNotice>

      <i18n-t id="auth-legal" keypath="auth.legal.acknowledgment" tag="p" class="legal-acknowledgment">
        <template #terms>
          <NuxtLink to="/legal/terms">{{ t('auth.legal.terms') }}</NuxtLink>
        </template>
        <template #privacy>
          <NuxtLink to="/legal/privacy">{{ t('auth.legal.privacy') }}</NuxtLink>
        </template>
      </i18n-t>

      <AppButton type="submit" :pending="isSubmitting" :disabled="requiresTurnstile && !turnstileToken">
        {{ submitLabel }}
      </AppButton>
    </form>
  </section>
</template>

<style scoped>
@layer components {
  .auth-entry-panel {
    display: grid;
    width: min(100%, 680px);
    gap: var(--space-4);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--color-surface-subtle);
    box-shadow: var(--shadow-panel);
  }

  .panel-heading {
    display: grid;
    gap: var(--space-1);
    margin-block-end: var(--space-4);
  }

  .eyebrow {
    margin: 0;
    color: var(--color-action);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-heavy);
    text-transform: uppercase;
  }

  .auth-intro {
    max-width: 54ch;
    margin: 0;
    color: var(--color-text-muted);
  }

  .auth-form {
    display: grid;
    gap: var(--space-3);
  }

  .auth-methods {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .auth-methods :deep(button[aria-pressed='true']) {
    border-color: var(--color-action);
    color: var(--color-action);
    background: var(--color-action-soft);
  }

  .phone-help {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .edit-phone {
    width: fit-content;
  }

  .legal-acknowledgment {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .legal-acknowledgment a {
    color: var(--color-text);
    font-weight: var(--font-weight-strong);
  }
}
</style>
