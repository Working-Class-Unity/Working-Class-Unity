import { getPublicModuleStates } from '../utils/module-state'
import { getPublicSocialProviderStates } from '../utils/auth/social'

export default defineEventHandler(() => ({
  modules: getPublicModuleStates(),
  socialProviders: getPublicSocialProviderStates()
}))
