<script setup lang="ts">
import { PROJECT_NAME_MAX_LENGTH, type ProjectCollectionView, type ProjectItemView } from '#shared/projects'
import { responseStatus } from '~/utils/http-error'

type ProjectNameFormHandle = {
  focus: () => void
}

const { t } = useI18n()
const { data: session, error: sessionError, status: sessionStatus, refresh: refreshSession } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const requestFetch = useRequestFetch()
const sessionUserId = computed(() => session.value?.user.id ?? null)
const createName = ref('')
const createValidationError = ref('')
const createError = ref('')
const createSuccess = ref('')
const createPending = ref(false)
const createdProjectId = ref('')
const createForm = ref<ProjectNameFormHandle | null>(null)
let createRequestGeneration = 0
let createAbortController: AbortController | undefined
let losingSession = false
let sessionVerificationFailed = Boolean(sessionError.value)

type OwnedProjectCollection = ProjectCollectionView & {
  ownerUserId: string
}

const {
  data: projectCollection,
  error: projectsError,
  status: projectsStatus,
  refresh: executeProjectsRequest,
  clear: clearProjectsRequest
} = await useAsyncData<OwnedProjectCollection>(
  'private-project-collection',
  async (_nuxtApp, { signal }) => {
    const requestedUserId = sessionUserId.value
    if (!requestedUserId) throw new Error('An authenticated user is required to load projects.')

    const result = await requestFetch<ProjectCollectionView>('/api/projects', { signal })
    return { ...result, ownerUserId: requestedUserId }
  },
  {
    enabled: () => Boolean(sessionUserId.value),
    lazy: true
  }
)

const visibleProjects = computed(() =>
  sessionUserId.value && projectCollection.value?.ownerUserId === sessionUserId.value
    ? projectCollection.value.projects
    : []
)
const projectsPending = computed(() => projectsStatus.value === 'pending')
const projectsLoaded = computed(
  () =>
    projectsStatus.value === 'success' &&
    Boolean(sessionUserId.value) &&
    projectCollection.value?.ownerUserId === sessionUserId.value
)

useHead(() => ({
  title: t('metadata.projects.title')
}))

watch(sessionUserId, async (userId, previousUserId) => {
  if (userId === previousUserId) return

  clearProjectsState()
  clearCreateState()
  if (userId) {
    await refreshProjects()
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

if (responseStatus(projectsError.value) === 401) {
  await loseSession()
}

watch(projectsError, (error) => {
  if (responseStatus(error) === 401) void loseSession()
})

onScopeDispose(() => {
  if (import.meta.server) return
  clearProjectsState()
  clearCreateState()
})

async function refreshProjects() {
  if (!sessionUserId.value) {
    clearProjectsState()
    return
  }

  await executeProjectsRequest()
  if (responseStatus(projectsError.value) === 401) {
    await loseSession()
  }
}

async function createProject() {
  const initiatingUserId = sessionUserId.value
  const normalizedName = createName.value.trim()
  createValidationError.value = ''
  createError.value = ''
  createSuccess.value = ''
  createdProjectId.value = ''

  if (!initiatingUserId) {
    await loseSession()
    return
  }
  if (!normalizedName) {
    createValidationError.value = t('projects.shared.nameRequired')
    await nextTick()
    createForm.value?.focus()
    return
  }
  if (normalizedName.length > PROJECT_NAME_MAX_LENGTH) {
    createValidationError.value = t('projects.shared.nameTooLong', { max: PROJECT_NAME_MAX_LENGTH })
    await nextTick()
    createForm.value?.focus()
    return
  }

  const requestGeneration = ++createRequestGeneration
  createAbortController?.abort()
  const abortController = new AbortController()
  createAbortController = abortController
  createPending.value = true

  try {
    const result = await $fetch<ProjectItemView>('/api/projects', {
      method: 'POST',
      signal: abortController.signal,
      body: { name: normalizedName }
    })
    if (
      abortController.signal.aborted ||
      requestGeneration !== createRequestGeneration ||
      sessionUserId.value !== initiatingUserId
    ) {
      return
    }

    projectCollection.value = {
      ownerUserId: initiatingUserId,
      projects: [result.project, ...visibleProjects.value.filter((project) => project.id !== result.project.id)]
    }
    createName.value = ''
    createdProjectId.value = result.project.id
    createSuccess.value = t('projects.list.created', { name: result.project.name })
    await nextTick()
    document.getElementById('created-project-link')?.focus()
  } catch (caught) {
    if (
      abortController.signal.aborted ||
      requestGeneration !== createRequestGeneration ||
      sessionUserId.value !== initiatingUserId
    ) {
      return
    }

    if (responseStatus(caught) === 401) {
      await loseSession()
      return
    }
    createError.value = t('projects.list.createFailed')
    await focusStatus('project-create-status')
  } finally {
    if (requestGeneration === createRequestGeneration) {
      createPending.value = false
    }
    if (createAbortController === abortController) {
      createAbortController = undefined
    }
  }
}

async function loseSession() {
  if (losingSession) return
  losingSession = true
  clearProjectsState()
  clearCreateState()
  session.value = null
  await navigateTo('/login')
}

function clearProjectsState() {
  clearProjectsRequest()
}

function clearCreateState() {
  createAbortController?.abort()
  createAbortController = undefined
  createRequestGeneration += 1
  createName.value = ''
  createValidationError.value = ''
  createError.value = ''
  createSuccess.value = ''
  createPending.value = false
  createdProjectId.value = ''
}

async function focusStatus(id: string) {
  await nextTick()
  document.getElementById(id)?.focus()
}
</script>

<template>
  <AppPage class="projects-page">
    <section class="panel projects-panel" aria-labelledby="projects-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('projects.list.eyebrow') }}</p>
        <h1 id="projects-title">{{ t('projects.list.title') }}</h1>
        <p>{{ t('projects.list.introduction') }}</p>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('projects.list.sessionUnavailable.title')"
        :description="t('common.sessionVerificationFailed')"
        :action-label="t('common.retry')"
        :busy="sessionStatus === 'pending'"
        @action="refreshSession()"
      />
      <UiStateBlock
        v-else-if="projectsPending"
        tone="loading"
        :title="t('projects.list.loading.title')"
        :description="t('projects.list.loading.description')"
      />
      <UiStateBlock
        v-else-if="projectsError"
        tone="error"
        :title="t('projects.list.unavailable.title')"
        :description="t('projects.list.unavailable.description')"
        :action-label="t('common.retry')"
        :busy="projectsPending"
        @action="refreshProjects()"
      />

      <div v-else-if="projectsLoaded" class="projects-content">
        <section class="project-create" aria-labelledby="create-project-title">
          <h2 id="create-project-title">{{ t('projects.list.createTitle') }}</h2>
          <ProjectNameForm
            ref="createForm"
            v-model="createName"
            input-id="new-project-name"
            :label="t('projects.shared.nameLabel')"
            :submit-label="t('projects.list.createAction')"
            :pending-label="t('projects.list.creating')"
            :busy="createPending"
            :error="createValidationError"
            @submit="createProject"
          />
          <AppStatusMessage v-if="createError" id="project-create-status" tabindex="-1" tone="error">
            {{ createError }}
          </AppStatusMessage>
          <AppStatusMessage v-else-if="createSuccess" tone="success">
            {{ createSuccess }}
          </AppStatusMessage>
        </section>

        <section class="project-list-section" aria-labelledby="project-list-title">
          <h2 id="project-list-title">{{ t('projects.list.yourProjects') }}</h2>
          <UiStateBlock
            v-if="visibleProjects.length === 0"
            tone="empty"
            :title="t('projects.list.empty.title')"
            :description="t('projects.list.empty.description')"
          />
          <ul v-else class="project-list">
            <li v-for="project in visibleProjects" :key="project.id" class="project-list-item">
              <NuxtLink
                :id="project.id === createdProjectId ? 'created-project-link' : undefined"
                class="project-link"
                no-prefetch
                :to="`/app/projects/${encodeURIComponent(project.id)}`"
              >
                <span>{{ project.name }}</span>
                <span aria-hidden="true">{{ t('projects.list.view') }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .projects-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .projects-panel,
  .projects-content,
  .project-create,
  .project-list-section {
    display: grid;
    min-width: 0;
    gap: var(--space-4);
  }

  .projects-panel {
    width: min(100%, 860px);
    padding: var(--space-5);
  }

  .panel-heading p,
  .project-create h2,
  .project-list-section h2 {
    margin: 0;
  }

  .panel-heading > p:last-child {
    max-width: 62ch;
    color: var(--color-text-muted);
  }

  .projects-content > section + section {
    border-top: var(--border-width) solid var(--color-border);
    padding-top: var(--space-5);
  }

  .project-list {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .project-list-item {
    min-width: 0;
  }

  .project-link {
    display: flex;
    min-block-size: var(--control-min-block-size);
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    color: var(--color-text);
    background: var(--color-surface);
    font-weight: var(--font-weight-strong);
    text-decoration: none;
  }

  .project-link:hover,
  .project-link:focus-visible {
    border-color: var(--color-action);
    background: var(--color-action-soft);
  }

  .project-link span:first-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .project-link span:last-child {
    flex: 0 0 auto;
    color: var(--color-action);
  }

  @media (width <= 520px) {
    .projects-panel {
      padding: var(--space-4);
    }

    .project-link {
      align-items: flex-start;
      flex-direction: column;
    }
  }
}
</style>
