<script setup lang="ts">
import { resolveAuthCallbacks, type AuthEntryIntent } from '#shared/auth-routes'
import { isPublicModuleReady } from '#shared/module-states'
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
const config = useRuntimeConfig()
const { t } = useI18n()
const { data: baseline, error: baselineError } = await useFetch('/api/baseline')
const email = ref('')
const emailInput = ref<HTMLInputElement | null>(null)
const turnstileChallenge = ref<TurnstileChallengeHandle | null>(null)
const turnstileToken = ref('')
const fieldError = ref('')
const formError = ref(route.query.error === undefined ? '' : t('auth.errors.authenticationFailed'))
const formSuccess = ref(route.query.status === 'signed-out' ? t('auth.status.signedOut') : '')
const isSubmitting = ref(false)
const isSigningInWithGoogle = ref(false)
const requiresTurnstile = isPublicModuleReady(config.public.moduleStates, 'turnstile')

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
const callbacks = computed(() => resolveAuthCallbacks(props.intent, route.query.returnTo))
const googleReady = computed(() => baseline.value?.socialProviders.google === 'ready')
const emailInputId = computed(() => `${props.intent}-email`)
const fieldErrorId = computed(() => `${props.intent}-email-error`)
const formStatusId = computed(() => `${props.intent}-form-status`)

watch(email, () => {
  fieldError.value = ''
})

async function submitAuth() {
  formError.value = ''
  formSuccess.value = ''
  fieldError.value = ''

  if (!validateAuthForm()) {
    formError.value = t('auth.errors.formInvalid')
    return
  }

  if (requiresTurnstile && !turnstileToken.value) {
    formError.value = t('auth.errors.securityRequired')
    return
  }

  isSubmitting.value = true

  try {
    const request = {
      email: email.value,
      ...callbacks.value
    }
    const result = requiresTurnstile
      ? await authClient.signIn.magicLink(request, {
          headers: { [turnstileHeaderName]: turnstileToken.value }
        })
      : await authClient.signIn.magicLink(request)

    if (result.error) {
      formError.value = t('auth.errors.emailLink')
      return
    }

    formSuccess.value = t('auth.status.emailLinkSent')
    email.value = ''
  } catch {
    formError.value = t('auth.errors.emailLink')
  } finally {
    if (requiresTurnstile) turnstileChallenge.value?.reset()
    isSubmitting.value = false
  }
}

async function signInWithGoogle() {
  if (!googleReady.value || isSigningInWithGoogle.value) return

  formError.value = ''
  formSuccess.value = ''
  isSigningInWithGoogle.value = true

  try {
    const result = await authClient.signIn.social({
      provider: 'google',
      ...callbacks.value
    })

    if (result.error) {
      formError.value = t('auth.errors.google')
    }
  } catch {
    formError.value = t('auth.errors.google')
  } finally {
    isSigningInWithGoogle.value = false
  }
}

function validateAuthForm() {
  if (!email.value.trim()) {
    fieldError.value = t('auth.email.required')
  } else if (emailInput.value && !emailInput.value.validity.valid) {
    fieldError.value = t('common.emailInvalid')
  }

  return !fieldError.value
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

      <button class="primary-button" type="submit" :disabled="isSubmitting || (requiresTurnstile && !turnstileToken)">
        {{ isSubmitting ? t('auth.email.sending') : t('auth.email.submit') }}
      </button>
    </form>

    <section class="social-auth" aria-labelledby="social-auth-title">
      <div>
        <h2 id="social-auth-title">{{ t('auth.social.title') }}</h2>
        <p v-if="googleReady">{{ t('auth.social.googleReady') }}</p>
        <p v-else-if="baselineError">{{ t('auth.social.providerUnavailable') }}</p>
        <p v-else>{{ t('auth.social.googleNotConfigured') }}</p>
      </div>
      <button
        v-if="googleReady"
        class="secondary-button social-auth-button"
        type="button"
        :disabled="isSigningInWithGoogle"
        @click="signInWithGoogle"
      >
        {{ isSigningInWithGoogle ? t('auth.social.openingGoogle') : t('auth.social.continueWithGoogle') }}
      </button>
    </section>
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

  .auth-form,
  .social-auth {
    display: grid;
    gap: var(--space-3);
  }

  .social-auth {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }

  .social-auth h2 {
    margin: 0;
    font-size: 1rem;
  }

  .social-auth p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
  }

  .social-auth-button {
    width: 100%;
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
