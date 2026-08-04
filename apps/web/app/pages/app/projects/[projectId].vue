<script setup lang="ts">
import { PROJECT_NAME_MAX_LENGTH, type ProjectItemView } from '#shared/projects'
import { responseStatus } from '~/utils/http-error'

type ProjectNameFormHandle = {
  focus: () => void
}

definePageMeta({
  key: (route) => route.fullPath
})

const route = useRoute()
const { t } = useI18n()
const rawProjectId = Array.isArray(route.params.projectId) ? route.params.projectId[0] : route.params.projectId
const projectId = typeof rawProjectId === 'string' ? rawProjectId : ''
const projectApiUrl = `/api/projects/${encodeURIComponent(projectId || '__invalid-project-id__')}`
const { data: session, error: sessionError, status: sessionStatus, refresh: refreshSession } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const requestFetch = useRequestFetch()
const sessionUserId = computed(() => session.value?.user.id ?? null)
const renameName = ref('')
const renameValidationError = ref('')
const renameError = ref('')
const renameSuccess = ref('')
const renamePending = ref(false)
const deleteError = ref('')
const deletePending = ref(false)
const mutationUnavailable = ref(false)
const renameForm = ref<ProjectNameFormHandle | null>(null)
let renameRequestGeneration = 0
let renameAbortController: AbortController | undefined
let deleteRequestGeneration = 0
let deleteAbortController: AbortController | undefined
let losingSession = false
let sessionVerificationFailed = Boolean(sessionError.value)

type OwnedProjectItem = ProjectItemView & {
  ownerUserId: string
}

const {
  data: projectItem,
  error: projectError,
  status: projectStatus,
  refresh: executeProjectRequest,
  clear: clearProjectRequest
} = await useAsyncData<OwnedProjectItem>(
  `private-project-${encodeURIComponent(projectId || 'invalid')}`,
  async (_nuxtApp, { signal }) => {
    const requestedUserId = sessionUserId.value
    if (!requestedUserId) throw new Error('An authenticated user is required to load a project.')

    const result = await requestFetch<ProjectItemView>(projectApiUrl, { signal })
    return { ...result, ownerUserId: requestedUserId }
  },
  {
    enabled: () => Boolean(sessionUserId.value),
    lazy: true
  }
)

const visibleProject = computed(() =>
  sessionUserId.value && projectItem.value?.ownerUserId === sessionUserId.value ? projectItem.value.project : null
)
const lookupStatus = computed(() => responseStatus(projectError.value))
const projectPending = computed(() => projectStatus.value === 'pending')
const projectUnavailable = computed(
  () => mutationUnavailable.value || lookupStatus.value === 400 || lookupStatus.value === 404
)
const projectRetryable = computed(
  () => Boolean(projectError.value) && lookupStatus.value !== 400 && lookupStatus.value !== 404
)

watch(
  visibleProject,
  (availableProject) => {
    if (availableProject) renameName.value = availableProject.name
  },
  { immediate: true }
)

useHead(() => ({
  title: visibleProject.value?.name ?? t('metadata.projectFallback.title')
}))

watch(sessionUserId, async (userId, previousUserId) => {
  if (userId === previousUserId) return

  clearProjectState()
  clearMutationState()
  if (userId) {
    await refreshProject()
  } else if (previousUserId) {
    await loseSession()
  }
})

watch([sessionError, sessionStatus], ([error, status]) => {
  if (error) {
    sessionVerificationFailed = true
    return
  }
  if (sessionVerificationFailed && status !== 'pending' && !sessionUserId.value) void loseSession()
})

if (responseStatus(projectError.value) === 401) {
  await loseSession()
}

watch(projectError, (error) => {
  if (responseStatus(error) === 401) void loseSession()
})

onScopeDispose(() => {
  if (import.meta.server) return
  clearProjectState()
  clearMutationState()
})

async function refreshProject() {
  if (!sessionUserId.value) {
    clearProjectState()
    return
  }

  mutationUnavailable.value = false
  clearMutationMessages()
  await executeProjectRequest()
  if (responseStatus(projectError.value) === 401) {
    await loseSession()
  }
}

async function renameProject() {
  const initiatingUserId = sessionUserId.value
  const currentProject = visibleProject.value
  const normalizedName = renameName.value.trim()
  renameValidationError.value = ''
  renameError.value = ''
  renameSuccess.value = ''

  if (!initiatingUserId) {
    await loseSession()
    return
  }
  if (!currentProject) return
  if (!normalizedName) {
    renameValidationError.value = t('projects.shared.nameRequired')
    await nextTick()
    renameForm.value?.focus()
    return
  }
  if (normalizedName.length > PROJECT_NAME_MAX_LENGTH) {
    renameValidationError.value = t('projects.shared.nameTooLong', { max: PROJECT_NAME_MAX_LENGTH })
    await nextTick()
    renameForm.value?.focus()
    return
  }

  const requestGeneration = ++renameRequestGeneration
  renameAbortController?.abort()
  const abortController = new AbortController()
  renameAbortController = abortController
  renamePending.value = true

  try {
    const result = await $fetch<ProjectItemView>(projectApiUrl, {
      method: 'PATCH',
      signal: abortController.signal,
      body: { name: normalizedName }
    })
    if (
      abortController.signal.aborted ||
      requestGeneration !== renameRequestGeneration ||
      sessionUserId.value !== initiatingUserId ||
      visibleProject.value?.id !== currentProject.id
    ) {
      return
    }

    projectItem.value = { ownerUserId: initiatingUserId, project: result.project }
    renameName.value = result.project.name
    renameSuccess.value = t('projects.detail.renamed')
    await focusStatus('project-rename-status')
  } catch (caught) {
    if (
      abortController.signal.aborted ||
      requestGeneration !== renameRequestGeneration ||
      sessionUserId.value !== initiatingUserId
    ) {
      return
    }

    const status = responseStatus(caught)
    if (status === 401) {
      await loseSession()
      return
    }
    if (status === 400 || status === 404) {
      showUnavailable(caught)
      return
    }
    renameError.value = t('projects.detail.renameFailed')
    await focusStatus('project-rename-status')
  } finally {
    if (requestGeneration === renameRequestGeneration) {
      renamePending.value = false
    }
    if (renameAbortController === abortController) {
      renameAbortController = undefined
    }
  }
}

async function deleteProject() {
  const initiatingUserId = sessionUserId.value
  const currentProject = visibleProject.value
  deleteError.value = ''

  if (!initiatingUserId) {
    await loseSession()
    return
  }
  if (!currentProject) return

  const requestGeneration = ++deleteRequestGeneration
  deleteAbortController?.abort()
  const abortController = new AbortController()
  deleteAbortController = abortController
  deletePending.value = true

  try {
    await $fetch<{ status: 'deleted' }>(projectApiUrl, {
      method: 'DELETE',
      signal: abortController.signal
    })
    if (
      abortController.signal.aborted ||
      requestGeneration !== deleteRequestGeneration ||
      sessionUserId.value !== initiatingUserId ||
      visibleProject.value?.id !== currentProject.id
    ) {
      return
    }

    await navigateTo('/app/projects')
  } catch (caught) {
    if (
      abortController.signal.aborted ||
      requestGeneration !== deleteRequestGeneration ||
      sessionUserId.value !== initiatingUserId
    ) {
      return
    }

    const status = responseStatus(caught)
    if (status === 401) {
      await loseSession()
      return
    }
    if (status === 400 || status === 404) {
      showUnavailable(caught)
      return
    }
    deleteError.value = t('projects.deletion.failed')
  } finally {
    if (requestGeneration === deleteRequestGeneration) {
      deletePending.value = false
    }
    if (deleteAbortController === abortController) {
      deleteAbortController = undefined
    }
  }
}

function showUnavailable(caught: unknown) {
  mutationUnavailable.value = responseStatus(caught) === 400 || responseStatus(caught) === 404
  projectItem.value = undefined
  clearMutationMessages()
}

async function loseSession() {
  if (losingSession) return
  losingSession = true
  clearProjectState()
  clearMutationState()
  session.value = null
  await navigateTo('/login')
}

function clearProjectState() {
  clearProjectRequest()
  mutationUnavailable.value = false
}

function clearMutationState() {
  renameAbortController?.abort()
  renameAbortController = undefined
  renameRequestGeneration += 1
  deleteAbortController?.abort()
  deleteAbortController = undefined
  deleteRequestGeneration += 1
  renameName.value = ''
  renamePending.value = false
  deletePending.value = false
  clearMutationMessages()
}

function clearMutationMessages() {
  renameValidationError.value = ''
  renameError.value = ''
  renameSuccess.value = ''
  deleteError.value = ''
}

async function focusStatus(id: string) {
  await nextTick()
  document.getElementById(id)?.focus()
}
</script>

<template>
  <AppPage class="project-page">
    <section class="panel project-panel" aria-labelledby="project-title">
      <div class="project-back-row">
        <NuxtLink to="/app/projects">← {{ t('projects.detail.allProjects') }}</NuxtLink>
      </div>

      <div class="panel-heading">
        <p class="eyebrow">{{ t('projects.detail.eyebrow') }}</p>
        <h1 id="project-title">{{ visibleProject?.name ?? t('projects.detail.fallbackTitle') }}</h1>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('projects.detail.sessionUnavailable.title')"
        :description="t('common.sessionVerificationFailed')"
        :action-label="t('common.retry')"
        :busy="sessionStatus === 'pending'"
        @action="refreshSession()"
      />
      <UiStateBlock
        v-else-if="projectPending"
        tone="loading"
        :title="t('projects.detail.loading.title')"
        :description="t('projects.detail.loading.description')"
      />
      <div v-else-if="projectUnavailable" class="project-state">
        <UiStateBlock
          tone="empty"
          :title="t('projects.detail.unavailable.title')"
          :description="t('projects.detail.unavailable.description')"
        />
        <NuxtLink class="secondary-button project-state-link" to="/app/projects">
          {{ t('projects.detail.returnToProjects') }}
        </NuxtLink>
      </div>
      <UiStateBlock
        v-else-if="projectRetryable"
        tone="error"
        :title="t('projects.detail.loadFailed.title')"
        :description="t('projects.detail.loadFailed.description')"
        :action-label="t('common.retry')"
        :busy="projectPending"
        @action="refreshProject()"
      />

      <div v-else-if="visibleProject" class="project-content">
        <section class="project-section" aria-labelledby="rename-project-title">
          <h2 id="rename-project-title">{{ t('projects.detail.renameTitle') }}</h2>
          <ProjectNameForm
            ref="renameForm"
            v-model="renameName"
            input-id="project-name"
            :label="t('projects.shared.nameLabel')"
            :submit-label="t('projects.detail.saveName')"
            :pending-label="t('projects.detail.saving')"
            :busy="renamePending || deletePending"
            :error="renameValidationError"
            @submit="renameProject"
          />
          <AppStatusMessage v-if="renameError" id="project-rename-status" tabindex="-1" tone="error">
            {{ renameError }}
          </AppStatusMessage>
          <AppStatusMessage v-else-if="renameSuccess" id="project-rename-status" tabindex="-1" tone="success">
            {{ renameSuccess }}
          </AppStatusMessage>
        </section>

        <ProjectDeletionSection
          class="project-section"
          :project-name="visibleProject.name"
          :busy="deletePending || renamePending"
          :error="deleteError"
          @delete="deleteProject"
        />
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .project-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .project-panel,
  .project-content,
  .project-section,
  .project-state {
    display: grid;
    min-width: 0;
    gap: var(--space-4);
  }

  .project-panel {
    width: min(100%, 760px);
    padding: var(--space-5);
  }

  .project-back-row a {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    align-items: center;
    font-weight: var(--font-weight-strong);
  }

  .panel-heading,
  .project-section h2 {
    margin: 0;
  }

  .panel-heading h1 {
    overflow-wrap: anywhere;
  }

  .project-content > section {
    border-top: var(--border-width) solid var(--color-border);
    padding-top: var(--space-5);
  }

  .project-state-link {
    width: fit-content;
    text-decoration: none;
  }

  @media (width <= 520px) {
    .project-panel {
      padding: var(--space-4);
    }

    .project-state-link {
      width: 100%;
    }
  }
}
</style>
