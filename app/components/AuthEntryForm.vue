<script setup lang="ts">
import { displayNameMaxLength, resolveAuthCallbacks, type AuthEntryIntent } from '#shared/auth-routes'
import { turnstileActions, turnstileHeaderName } from '#shared/turnstile'
import { authClient } from '~/lib/auth-client'

type TurnstileChallengeHandle = {
  reset: () => void
}

const props = defineProps<{
  intent: AuthEntryIntent
  sessionError?: string
}>()

const route = useRoute()
const { t } = useI18n()
const displayName = ref('')
const displayNameInput = ref<HTMLInputElement | null>(null)
const displayNameError = ref('')
const email = ref('')
const emailInput = ref<HTMLInputElement | null>(null)
const turnstileChallenge = ref<TurnstileChallengeHandle | null>(null)
const turnstileToken = ref('')
const fieldError = ref('')
const formError = ref(route.query.error === undefined ? '' : t('auth.errors.authenticationFailed'))
const formSuccess = ref(route.query.status === 'signed-out' ? t('auth.status.signedOut') : '')
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
const displayNameInputId = computed(() => `${props.intent}-display-name`)
const emailInputId = computed(() => `${props.intent}-email`)
const formStatusId = computed(() => `${props.intent}-form-status`)

watch(displayName, () => {
  displayNameError.value = ''
})

watch(email, () => {
  fieldError.value = ''
})

async function submitAuth() {
  formError.value = ''
  formSuccess.value = ''
  displayNameError.value = ''
  fieldError.value = ''

  if (!validateAuthForm()) {
    formError.value = t('auth.errors.formInvalid')
    await focusFirstInvalidControl()
    return
  }

  if (!turnstileToken.value) {
    formError.value = t('auth.errors.securityRequired')
    return
  }

  isSubmitting.value = true

  try {
    const request = {
      name: displayName.value,
      email: email.value,
      ...callbacks.value
    }
    const result = await authClient.signIn.magicLink(request, {
      headers: { [turnstileHeaderName]: turnstileToken.value }
    })

    if (result.error) {
      formError.value = t('auth.errors.emailLink')
      return
    }

    formSuccess.value = t('auth.status.emailLinkSent')
    displayName.value = ''
    email.value = ''
  } catch {
    formError.value = t('auth.errors.emailLink')
  } finally {
    turnstileChallenge.value?.reset()
    isSubmitting.value = false
  }
}

async function focusFirstInvalidControl() {
  await nextTick()
  if (displayNameError.value) {
    displayNameInput.value?.focus()
    return
  }
  emailInput.value?.focus()
}

function validateAuthForm() {
  if (!displayName.value.trim()) {
    displayNameError.value = t('auth.displayName.required')
  } else if (displayName.value.length > displayNameMaxLength) {
    displayNameError.value = t('auth.displayName.tooLong', { max: displayNameMaxLength })
  }

  if (!email.value.trim()) {
    fieldError.value = t('auth.email.required')
  } else if (emailInput.value && !emailInput.value.validity.valid) {
    fieldError.value = t('common.emailInvalid')
  }

  return !displayNameError.value && !fieldError.value
}
</script>

<template>
  <section class="auth-entry-panel" :aria-labelledby="`${intent}-title`">
    <div class="panel-heading">
      <p class="eyebrow">{{ copy.eyebrow }}</p>
      <h1 :id="`${intent}-title`">{{ copy.title }}</h1>
      <p class="auth-intro">{{ copy.intro }}</p>
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
        :id="displayNameInputId"
        :label="t('auth.displayName.label')"
        :hint="t('auth.displayName.help')"
        :error="displayNameError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
            :id="id"
            ref="displayNameInput"
            v-model.trim="displayName"
            name="name"
            type="text"
            autocomplete="name"
            :maxlength="displayNameMaxLength"
            :aria-describedby="describedBy"
            :aria-invalid="invalid ? 'true' : undefined"
            :required="required"
          />
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>

      <AppField
        :id="emailInputId"
        :label="t('common.email')"
        :error="fieldError"
        required
        :required-label="t('common.required')"
      >
        <template #default="{ id, describedBy, invalid, required }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
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
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>

      <TurnstileChallenge ref="turnstileChallenge" v-model="turnstileToken" :action="turnstileActions.magicLink" />

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

      <AppButton type="submit" :pending="isSubmitting" :disabled="!turnstileToken">
        {{ isSubmitting ? t('auth.email.sending') : t('auth.email.submit') }}
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
