<script setup lang="ts">
type Tier = 'supporter' | 'member' | 'solidarity'

const tiers = ['supporter', 'member', 'solidarity'] as const satisfies readonly Tier[]

const route = useRoute()
const { t } = useI18n()
const tier = ref<Tier>('member')
const pending = ref(false)
const errorKey = ref(route.query.error ? 'join.errors.invalidLink' : '')

useHead(() => ({ title: t('join.title') }))

async function startCheckout() {
  errorKey.value = ''
  pending.value = true
  try {
    const result = await $fetch<{ url: string }>('/api/join/checkout', {
      method: 'POST',
      body: { tier: tier.value }
    })
    if (!result.url.startsWith('https://')) throw new Error('Unexpected Checkout URL')
    await navigateTo(result.url, { external: true })
  } catch {
    errorKey.value = 'join.errors.checkoutUnavailable'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="flow" aria-labelledby="join-title">
    <h1 id="join-title">{{ t('join.title') }}</h1>

    <form class="flow" @submit.prevent="startCheckout">
      <fieldset class="grid">
        <legend>{{ t('join.chooseTier') }}</legend>
        <label v-for="option in tiers" :key="option" class="cluster">
          <input v-model="tier" type="radio" name="tier" :value="option" />
          <span class="grid">
            <strong>{{ t(`join.tiers.${option}.name`) }}</strong>
            <b>{{ t(`join.tiers.${option}.price`) }}</b>
          </span>
        </label>
      </fieldset>
      <p>{{ t('join.tierExplanation') }}</p>

      <AppNotice v-if="errorKey" tone="error" announce="assertive">{{ t(errorKey) }}</AppNotice>
      <div class="flow">
        <AppButton type="submit" :pending="pending">{{ t('join.continueToStripe') }}</AppButton>
        <p>
          <a href="https://chat.workingclassunity.com/docs?topic=186">{{ t('join.codeOfConduct') }}</a>
        </p>
      </div>
    </form>
  </section>
</template>
