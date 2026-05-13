<template>
  <div class="flex flex-col h-full bg-gray-950">
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold">Agent Activity</h2>
        <button
          @click="refreshAgents"
          :disabled="loading"
          class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="loading && agents.length === 0" class="text-gray-400 text-center py-12">
        Loading agents...
      </div>

      <div v-else-if="error" class="bg-red-900 text-red-100 p-4 rounded-lg mb-4">
        {{ error }}
      </div>

      <div v-else-if="agents.length === 0" class="text-gray-400 text-center py-12">
        No active agents
      </div>

      <div v-else class="grid gap-4">
        <div
          v-for="agent in agents"
          :key="agent.slug + (agent.characterName || '')"
          class="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors"
        >
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <h3 class="font-bold text-gray-100">{{ agent.name }}</h3>
              <div class="flex items-center gap-2 mt-1">
                <p class="text-sm text-gray-500">{{ agent.slug }}</p>
                <span v-if="agent.roleTitle" class="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                  {{ agent.roleTitle }}
                </span>
                <span v-if="agent.universe" class="text-xs bg-purple-900 text-purple-200 px-2 py-0.5 rounded">
                  🎬 {{ agent.universe }}
                </span>
              </div>
            </div>
            <span :class="[
              'px-3 py-1 rounded text-xs font-medium',
              agent.status === 'working'
                ? 'bg-blue-900 text-blue-100'
                : agent.status === 'error'
                  ? 'bg-red-900 text-red-100'
                  : 'bg-green-900 text-green-100'
            ]">
              <span v-if="agent.status === 'working'" class="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1 animate-pulse"></span>
              {{ agent.status === 'working' ? 'Working' : agent.status === 'error' ? 'Error' : 'Idle' }}
            </span>
          </div>

          <div v-if="agent.currentTask" class="bg-gray-700 rounded p-3 mb-2">
            <p class="text-xs text-gray-400 mb-1">Current Task:</p>
            <p class="text-sm text-gray-100 break-words">{{ agent.currentTask }}</p>
          </div>

          <div class="flex justify-between items-center">
            <div class="text-xs text-gray-500">
              Last updated: {{ formatTime(new Date()) }}
            </div>
            <button
              v-if="agent.status === 'working' && agent.currentTaskId"
              type="button"
              @click="stopTask(agent.currentTaskId)"
              :disabled="stoppingTaskIds.has(agent.currentTaskId)"
              class="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs px-3 py-1 rounded transition-colors flex items-center gap-1"
              title="Stop this agent's current task"
            >
              <span class="inline-block w-2 h-2 bg-white rounded-sm"></span>
              {{ stoppingTaskIds.has(agent.currentTaskId) ? 'Stopping...' : 'Stop' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { apiFetch } from '../lib/api'

interface Agent {
  slug: string
  name: string
  characterName?: string
  roleTitle?: string
  universe?: string
  status: 'idle' | 'working' | 'error'
  currentTask?: string
  currentTaskId?: string
}

const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const stoppingTaskIds = ref<Set<string>>(new Set())
let refreshInterval: NodeJS.Timer | null = null

const stopTask = async (taskId: string) => {
  if (stoppingTaskIds.value.has(taskId)) return
  stoppingTaskIds.value.add(taskId)
  // Force reactivity for Set
  stoppingTaskIds.value = new Set(stoppingTaskIds.value)
  try {
    await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
    await refreshAgents()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to stop task'
  } finally {
    stoppingTaskIds.value.delete(taskId)
    stoppingTaskIds.value = new Set(stoppingTaskIds.value)
  }
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

const refreshAgents = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await apiFetch('/api/agents')
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = (await response.json()) as { agents: Agent[] }
    agents.value = data.agents
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load agents'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refreshAgents()
  refreshInterval = setInterval(refreshAgents, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style scoped>
</style>
