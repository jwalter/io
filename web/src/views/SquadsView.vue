<template>
  <div class="flex flex-col h-full bg-gray-950">
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold">Squads & Dashboard</h2>
        <button
          @click="showCreateForm = !showCreateForm"
          class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          {{ showCreateForm ? 'Cancel' : 'New Squad' }}
        </button>
      </div>

      <!-- Create Squad Form -->
      <form
        v-if="showCreateForm"
        @submit.prevent="createSquad"
        class="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6"
      >
        <h3 class="font-bold text-gray-100 mb-4">Create New Squad</h3>
        <div class="space-y-3">
          <input
            v-model="form.slug"
            type="text"
            placeholder="Squad slug (e.g., frontend-team)"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            v-model="form.name"
            type="text"
            placeholder="Squad name (e.g., Frontend Team)"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            v-model="form.projectPath"
            type="text"
            placeholder="Project path (e.g., /path/to/project)"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            :disabled="creating || !form.slug || !form.name || !form.projectPath"
            class="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white px-4 py-2 rounded text-sm transition-colors"
          >
            {{ creating ? 'Creating...' : 'Create Squad' }}
          </button>
        </div>
        <div v-if="createError" class="mt-2 text-red-400 text-sm">
          {{ createError }}
        </div>
      </form>

      <!-- Squads List -->
      <div v-if="loading" class="text-gray-400 text-center py-12">
        Loading squads...
      </div>

      <div v-else-if="error" class="bg-red-900 text-red-100 p-4 rounded-lg mb-4">
        {{ error }}
      </div>

      <div v-else-if="squads.length === 0" class="text-gray-400 text-center py-12">
        No squads created yet
      </div>

      <div v-else class="grid gap-4">
        <div
          v-for="squad in squads"
          :key="squad.id"
          class="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors"
        >
          <button
            type="button"
            @click="toggleSquad(squad.slug)"
            class="w-full text-left focus:outline-none"
            :aria-expanded="isExpanded(squad.slug)"
          >
            <div class="flex justify-between items-start mb-3">
              <div class="flex-1 flex items-center gap-2">
                <span
                  class="inline-block transition-transform text-gray-400"
                  :class="isExpanded(squad.slug) ? 'rotate-90' : ''"
                >▶</span>
                <div>
                  <h3 class="font-bold text-gray-100">{{ squad.name }}</h3>
                  <p class="text-sm text-gray-500">{{ squad.slug }}</p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="squad.universe" class="px-2 py-1 rounded text-xs font-medium bg-purple-900 text-purple-100">
                  🎬 {{ universeLabel(squad.universe) }}
                </span>
                <span :class="[
                  'px-2 py-1 rounded text-xs font-medium',
                  squad.status === 'working'
                    ? 'bg-blue-900 text-blue-100'
                    : squad.status === 'error'
                      ? 'bg-red-900 text-red-100'
                      : 'bg-gray-700 text-gray-200'
                ]">
                  {{ squad.status }}
                </span>
              </div>
            </div>
            <p class="text-sm text-gray-400">📁 {{ squad.project_path }}</p>
          </button>

          <div v-if="isExpanded(squad.slug)" class="mt-4 pt-4 border-t border-gray-700">
            <div class="flex justify-between items-center text-xs text-gray-500 mb-3">
              <span v-if="squad.model">Model: {{ squad.model }}</span>
              <span>{{ formatDate(squad.created_at) }}</span>
            </div>

            <h4 class="font-semibold text-gray-200 text-sm mb-2">Team Roster</h4>
            <div v-if="agentsLoading[squad.slug]" class="text-gray-400 text-sm py-2">
              Loading agents...
            </div>
            <div v-else-if="agentsError[squad.slug]" class="text-red-400 text-sm py-2">
              {{ agentsError[squad.slug] }}
            </div>
            <div v-else-if="!agentsBySquad[squad.slug] || agentsBySquad[squad.slug].length === 0"
                 class="text-gray-500 text-sm italic py-2">
              No agents assigned yet
            </div>
            <ul v-else class="space-y-2">
              <li
                v-for="agent in agentsBySquad[squad.slug]"
                :key="agent.id ?? agent.character_name"
                class="flex items-center gap-3 rounded px-3 py-2"
                :class="agent.status === 'working' ? 'bg-blue-950 border border-blue-800' : 'bg-gray-900 border border-gray-700'"
              >
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium text-gray-100">{{ agent.character_name }}</span>
                  <span class="text-xs text-gray-500 ml-2">{{ agent.role_title }}</span>
                </div>
                <span :class="[
                  'px-2 py-0.5 rounded text-xs',
                  agent.status === 'working' ? 'bg-blue-800 text-blue-200' :
                  agent.status === 'error' ? 'bg-red-800 text-red-200' :
                  'bg-gray-700 text-gray-400'
                ]">
                  {{ agent.status }}
                </span>
                <button
                  v-if="agent.status === 'working' && agent.currentTaskId"
                  type="button"
                  @click="stopAgentTask(squad.slug, agent.currentTaskId)"
                  :disabled="stoppingTaskIds.has(agent.currentTaskId)"
                  class="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs px-2 py-1 rounded transition-colors flex items-center gap-1"
                  title="Stop this agent's current task"
                >
                  <span class="inline-block w-2 h-2 bg-white rounded-sm"></span>
                  {{ stoppingTaskIds.has(agent.currentTaskId) ? 'Stopping...' : 'Stop' }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { apiFetch } from '../lib/api'

interface Squad {
  id: number
  slug: string
  name: string
  project_path: string
  copilot_session_id: string | null
  model: string | null
  universe: string | null
  status: string
  created_at: string
  updated_at: string
}

interface SquadAgent {
  id?: number
  squad_slug?: string
  character_name: string
  role_title: string
  charter?: string | null
  model_tier?: string
  personality?: string | null
  status: string
  currentTaskId?: string | null
  currentTask?: string | null
}

const UNIVERSE_NAMES: Record<string, string> = {
  'a-team': 'The A-Team',
  'transformers': 'Transformers',
  'thundercats': 'ThunderCats',
  'gi-joe': 'G.I. Joe',
  'aliens': 'Aliens',
  'ghostbusters': 'Ghostbusters',
}

const squads = ref<Squad[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showCreateForm = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)

const expanded = reactive<Record<string, boolean>>({})
const agentsBySquad = reactive<Record<string, SquadAgent[]>>({})
const agentsLoading = reactive<Record<string, boolean>>({})
const agentsError = reactive<Record<string, string | null>>({})
const stoppingTaskIds = ref<Set<string>>(new Set())

const stopAgentTask = async (squadSlug: string, taskId: string) => {
  if (stoppingTaskIds.value.has(taskId)) return
  stoppingTaskIds.value = new Set(stoppingTaskIds.value).add(taskId)
  try {
    await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
    await loadAgents(squadSlug, true)
  } catch (e) {
    agentsError[squadSlug] = e instanceof Error ? e.message : 'Failed to stop task'
  } finally {
    const next = new Set(stoppingTaskIds.value)
    next.delete(taskId)
    stoppingTaskIds.value = next
  }
}

const form = ref({
  slug: '',
  name: '',
  projectPath: '',
})

const universeLabel = (id: string | null) => {
  if (!id) return ''
  return UNIVERSE_NAMES[id] ?? id
}

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const isExpanded = (slug: string) => !!expanded[slug]

const toggleSquad = async (slug: string) => {
  expanded[slug] = !expanded[slug]
  if (expanded[slug] && !agentsBySquad[slug] && !agentsLoading[slug]) {
    await loadAgents(slug)
  }
}

const loadAgents = async (slug: string, force = false) => {
  if (!force && agentsLoading[slug]) return
  agentsLoading[slug] = true
  agentsError[slug] = null
  try {
    const response = await apiFetch(`/api/squads/${encodeURIComponent(slug)}/agents`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = (await response.json()) as { agents: SquadAgent[] }
    agentsBySquad[slug] = data.agents
  } catch (e) {
    agentsError[slug] = e instanceof Error ? e.message : 'Failed to load agents'
  } finally {
    agentsLoading[slug] = false
  }
}

const loadSquads = async () => {
  try {
    const response = await apiFetch('/api/squads')
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = (await response.json()) as { squads: Squad[] }
    squads.value = data.squads
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load squads'
  } finally {
    loading.value = false
  }
}

const createSquad = async () => {
  if (!form.value.slug || !form.value.name || !form.value.projectPath) {
    createError.value = 'All fields are required'
    return
  }

  creating.value = true
  createError.value = null

  try {
    const response = await apiFetch('/api/squads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: form.value.slug,
        name: form.value.name,
        projectPath: form.value.projectPath,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Reset form and reload squads
    form.value = { slug: '', name: '', projectPath: '' }
    showCreateForm.value = false
    await loadSquads()
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create squad'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  loadSquads()
})
</script>

<style scoped>
</style>
