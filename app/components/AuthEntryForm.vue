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
const displayNameErrorId = computed(() => `${props.intent}-display-name-error`)
const displayNameHelpId = computed(() => `${props.intent}-display-name-help`)
const emailInputId = computed(() => `${props.intent}-email`)
const fieldErrorId = computed(() => `${props.intent}-email-error`)
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
  <section class="panel auth-entry-panel" :aria-labelledby="`${intent}-title`">
    <div class="panel-heading">
      <p class="eyebrow">{{ copy.eyebrow }}</p>
      <h1 :id="`${intent}-title`">{{ copy.title }}</h1>
      <p class="auth-intro">{{ copy.intro }}</p>
    </div>

    <UiStateBlock
      v-if="sessionError"
      tone="error"
      :title="t('auth.sessionUnavailable.title')"
      :description="t('auth.sessionUnavailable.description')"
    />

    <form
      class="auth-form"
      :aria-describedby="formError || formSuccess ? `${formStatusId} auth-legal` : 'auth-legal'"
      novalidate
      @submit.prevent="submitAuth"
    >
      <div class="form-field">
        <label :for="displayNameInputId">{{ t('auth.displayName.label') }}</label>
        <!-- eslint-disable vue/html-self-closing -->
        <input
          :id="displayNameInputId"
          v-model.trim="displayName"
          name="name"
          type="text"
          autocomplete="name"
          :maxlength="displayNameMaxLength"
          :aria-describedby="displayNameError ? `${displayNameHelpId} ${displayNameErrorId}` : displayNameHelpId"
          :aria-invalid="displayNameError ? 'true' : undefined"
          required
        />
        <!-- eslint-enable vue/html-self-closing -->
        <small :id="displayNameHelpId">{{ t('auth.displayName.help') }}</small>
        <small v-if="displayNameError" :id="displayNameErrorId" class="field-error">
          {{ displayNameError }}
        </small>
      </div>

      <label class="form-field" :for="emailInputId">
        <span>{{ t('common.email') }}</span>
        <!-- eslint-disable vue/html-self-closing -->
        <input
          :id="emailInputId"
          ref="emailInput"
          v-model.trim="email"
          name="email"
          type="email"
          autocomplete="email"
          :aria-describedby="fieldError ? fieldErrorId : undefined"
          :aria-invalid="fieldError ? 'true' : undefined"
          required
        />
        <!-- eslint-enable vue/html-self-closing -->
        <small v-if="fieldError" :id="fieldErrorId" class="field-error">
          {{ fieldError }}
        </small>
      </label>

      <TurnstileChallenge ref="turnstileChallenge" v-model="turnstileToken" :action="turnstileActions.magicLink" />

      <AppStatusMessage v-if="formError" :id="formStatusId" tone="error">
        {{ formError }}
      </AppStatusMessage>
      <AppStatusMessage v-else-if="formSuccess" :id="formStatusId" tone="success">
        {{ formSuccess }}
      </AppStatusMessage>

      <i18n-t id="auth-legal" keypath="auth.legal.acknowledgment" tag="p" class="legal-acknowledgment">
        <template #terms>
          <NuxtLink to="/legal/terms">{{ t('auth.legal.terms') }}</NuxtLink>
        </template>
        <template #privacy>
          <NuxtLink to="/legal/privacy">{{ t('auth.legal.privacy') }}</NuxtLink>
        </template>
      </i18n-t>

      <button class="primary-button" type="submit" :disabled="isSubmitting || !turnstileToken">
        {{ isSubmitting ? t('auth.email.sending') : t('auth.email.submit') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
@layer components {
  .auth-entry-panel {
    display: grid;
    width: min(100%, 680px);
    gap: var(--space-4);
    padding: var(--space-5);
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
