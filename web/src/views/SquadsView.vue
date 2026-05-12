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
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <h3 class="font-bold text-gray-100">{{ squad.name }}</h3>
              <p class="text-sm text-gray-500">{{ squad.slug }}</p>
            </div>
            <span :class="[
              'px-2 py-1 rounded text-xs font-medium',
              squad.status === 'active'
                ? 'bg-green-900 text-green-100'
                : squad.status === 'error'
                  ? 'bg-red-900 text-red-100'
                  : 'bg-gray-700 text-gray-200'
            ]">
              {{ squad.status }}
            </span>
          </div>
          <p class="text-sm text-gray-400 mb-2">📁 {{ squad.project_path }}</p>
          <div class="flex justify-between items-center text-xs text-gray-500">
            <span v-if="squad.model">Model: {{ squad.model }}</span>
            <span>{{ formatDate(squad.created_at) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Squad {
  id: number
  slug: string
  name: string
  project_path: string
  copilot_session_id: string | null
  model: string | null
  status: string
  created_at: string
  updated_at: string
}

const squads = ref<Squad[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showCreateForm = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)

const form = ref({
  slug: '',
  name: '',
  projectPath: '',
})

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const loadSquads = async () => {
  try {
    const response = await fetch('/api/squads')
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
    const response = await fetch('/api/squads', {
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
