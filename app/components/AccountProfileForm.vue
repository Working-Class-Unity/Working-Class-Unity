<script setup lang="ts">
import { profileNameMaxLength, type AccountProfile } from '#shared/profile'
import { authClient } from '~/lib/auth-client'

const props = defineProps<{
  user: AccountProfile
}>()

const emit = defineEmits<{
  updated: [profile: AccountProfile]
}>()

const { t } = useI18n()
const firstName = ref(props.user.firstName ?? '')
const lastName = ref(props.user.lastName ?? '')
const displayName = ref(props.user.displayName ?? '')
const formError = ref('')
const formSuccess = ref('')
const isSubmitting = ref(false)

watch([firstName, lastName, displayName], () => {
  formError.value = ''
  formSuccess.value = ''
})

async function saveProfile() {
  if (isSubmitting.value) return

  formError.value = ''
  formSuccess.value = ''

  const profile: AccountProfile = {
    firstName: normalizeProfileValue(firstName.value),
    lastName: normalizeProfileValue(lastName.value),
    displayName: normalizeProfileValue(displayName.value)
  }

  isSubmitting.value = true
  try {
    const result = await authClient.updateUser(profile)
    if (result.error) {
      formError.value = t('account.profile.saveError')
      return
    }

    firstName.value = profile.firstName ?? ''
    lastName.value = profile.lastName ?? ''
    displayName.value = profile.displayName ?? ''
    emit('updated', profile)
    await nextTick()
    formSuccess.value = t('account.profile.saved')
  } catch {
    formError.value = t('account.profile.saveError')
  } finally {
    isSubmitting.value = false
  }
}

function normalizeProfileValue(value: string): string | null {
  return value.trim() || null
}
</script>

<template>
  <section class="account-section profile-section" aria-labelledby="profile-settings-title">
    <div>
      <h2 id="profile-settings-title">{{ t('account.profile.title') }}</h2>
      <p>{{ t('account.profile.description') }}</p>
    </div>

    <form class="profile-form" aria-describedby="profile-settings-description" novalidate @submit.prevent="saveProfile">
      <p id="profile-settings-description" class="profile-help">{{ t('account.profile.help') }}</p>

      <AppField id="account-first-name" :label="t('account.profile.firstName')" :hint="t('account.profile.optional')">
        <template #default="{ id, describedBy }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
            :id="id"
            v-model="firstName"
            name="firstName"
            type="text"
            autocomplete="given-name"
            :maxlength="profileNameMaxLength"
            :aria-describedby="describedBy"
            :disabled="isSubmitting"
          />
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>

      <AppField id="account-last-name" :label="t('account.profile.lastName')" :hint="t('account.profile.optional')">
        <template #default="{ id, describedBy }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
            :id="id"
            v-model="lastName"
            name="lastName"
            type="text"
            autocomplete="family-name"
            :maxlength="profileNameMaxLength"
            :aria-describedby="describedBy"
            :disabled="isSubmitting"
          />
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>

      <AppField
        id="account-display-name"
        :label="t('account.profile.displayName')"
        :hint="t('account.profile.displayNameHelp')"
      >
        <template #default="{ id, describedBy }">
          <!-- eslint-disable vue/html-self-closing -->
          <input
            :id="id"
            v-model="displayName"
            name="displayName"
            type="text"
            autocomplete="nickname"
            :maxlength="profileNameMaxLength"
            :aria-describedby="describedBy"
            :disabled="isSubmitting"
          />
          <!-- eslint-enable vue/html-self-closing -->
        </template>
      </AppField>

      <AppNotice v-if="formError" tone="error" announce="assertive">{{ formError }}</AppNotice>
      <AppNotice v-else-if="formSuccess" tone="success" announce="polite">{{ formSuccess }}</AppNotice>

      <AppButton class="profile-submit" type="submit" :pending="isSubmitting">
        {{ isSubmitting ? t('account.profile.saving') : t('account.profile.save') }}
      </AppButton>
    </form>
  </section>
</template>

<style scoped>
@layer components {
  .profile-section,
  .profile-form {
    display: grid;
    gap: var(--space-3);
  }

  .profile-help {
    margin: 0;
    color: var(--color-text-muted);
  }

  .profile-submit {
    width: fit-content;
  }

  @media (width <= 620px) {
    .profile-submit {
      width: 100%;
    }
  }
}
</style>
