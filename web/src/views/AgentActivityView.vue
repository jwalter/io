<template>
  <div class="flex flex-col h-full bg-gray-950">
    <div class="flex-1 overflow-y-auto p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold">Agent Activity</h2>
        <button
          @click="refreshAll"
          :disabled="loading"
          class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="error" class="bg-red-900 text-red-100 p-4 rounded-lg mb-4">
        {{ error }}
      </div>

      <!-- Active agents -->
      <section class="mb-8">
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Active Agents</h3>
        <div v-if="loading && agents.length === 0" class="text-gray-400 text-center py-8">
          Loading agents...
        </div>
        <div v-else-if="agents.length === 0" class="text-gray-400 text-center py-8">
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
                  <span
                    v-if="agent.model && agent.status === 'working'"
                    class="text-xs bg-emerald-900 text-emerald-200 px-2 py-0.5 rounded"
                    :title="`Model: ${agent.model}`"
                  >
                    🧠 {{ agent.model }}
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
      </section>

      <!-- Recent activity -->
      <section>
        <h3 class="text-lg font-semibold text-gray-200 mb-3">Recent Activity</h3>
        <div v-if="loading && tasks.length === 0" class="text-gray-400 text-center py-8">
          Loading activity...
        </div>
        <div v-else-if="tasks.length === 0" class="text-gray-400 text-center py-8">
          No recent activity yet
        </div>
        <ul v-else class="bg-gray-800 border border-gray-700 rounded-lg divide-y divide-gray-700 overflow-hidden">
          <li v-for="task in tasks" :key="task.task_id">
            <button
              type="button"
              @click="openTask(task.task_id)"
              class="w-full text-left p-4 hover:bg-gray-750 focus:bg-gray-750 focus:outline-none transition-colors"
            >
              <div class="flex justify-between items-start gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-medium text-gray-100 truncate">{{ task.agent_slug }}</span>
                    <span v-if="task.origin_channel" class="text-xs text-gray-500">via {{ task.origin_channel }}</span>
                  </div>
                  <p class="text-sm text-gray-300 truncate">{{ task.description }}</p>
                  <p class="text-xs text-gray-500 mt-1">
                    Started {{ formatDateTime(task.started_at) }}
                    <span v-if="task.completed_at"> · Completed {{ formatDateTime(task.completed_at) }}</span>
                  </p>
                </div>
                <span :class="['px-2 py-1 rounded text-xs font-medium whitespace-nowrap', statusBadgeClass(task.status)]">
                  {{ task.status }}
                </span>
              </div>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- Detail modal -->
    <div
      v-if="selectedTaskId"
      class="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      @click.self="closeTask"
    >
      <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div class="flex justify-between items-center p-4 border-b border-gray-700">
          <h3 class="text-lg font-bold text-gray-100">Task Details</h3>
          <button
            type="button"
            @click="closeTask"
            class="text-gray-400 hover:text-gray-100 text-2xl leading-none focus:outline-none"
            aria-label="Close"
          >×</button>
        </div>

        <div class="overflow-y-auto p-5 space-y-4">
          <div v-if="detailLoading" class="text-gray-400 text-center py-8">Loading task...</div>
          <div v-else-if="detailError" class="bg-red-900 text-red-100 p-3 rounded text-sm">
            {{ detailError }}
          </div>
          <template v-else-if="selectedTask">
            <div class="flex justify-between items-start gap-3">
              <div>
                <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Agent</p>
                <p class="text-sm text-gray-100 font-medium">{{ selectedTask.agent_slug }}</p>
              </div>
              <span :class="['px-3 py-1 rounded text-xs font-medium', statusBadgeClass(selectedTask.status)]">
                {{ selectedTask.status }}
              </span>
            </div>

            <div>
              <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Task ID</p>
              <p class="text-xs text-gray-400 font-mono break-all">{{ selectedTask.task_id }}</p>
            </div>

            <div v-if="selectedTask.origin_channel">
              <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Origin</p>
              <p class="text-sm text-gray-200">{{ selectedTask.origin_channel }}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Started</p>
                <p class="text-sm text-gray-200">{{ formatDateTime(selectedTask.started_at) }}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Completed</p>
                <p class="text-sm text-gray-200">
                  {{ selectedTask.completed_at ? formatDateTime(selectedTask.completed_at) : '—' }}
                </p>
              </div>
            </div>

            <div v-if="durationLabel">
              <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Duration</p>
              <p class="text-sm text-gray-200">{{ durationLabel }}</p>
            </div>

            <div>
              <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Description</p>
              <pre class="text-sm text-gray-100 bg-gray-800 border border-gray-700 rounded p-3 whitespace-pre-wrap break-words font-sans">{{ selectedTask.description }}</pre>
            </div>

            <div>
              <div class="flex justify-between items-center mb-2">
                <p class="text-xs uppercase tracking-wider text-gray-500">Activity</p>
                <label class="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    v-model="showActivityDetails"
                    class="rounded bg-gray-700 border-gray-600"
                  />
                  Show details
                </label>
              </div>
              <div
                v-if="activityLoading && activity.length === 0"
                class="text-sm text-gray-500 italic"
              >Loading activity…</div>
              <div
                v-else-if="activity.length === 0"
                class="text-sm text-gray-500 italic"
              >No activity yet</div>
              <ul
                v-else
                class="bg-gray-800 border border-gray-700 rounded divide-y divide-gray-700 max-h-96 overflow-y-auto"
              >
                <li
                  v-for="(entry, idx) in activity"
                  :key="`${entry.ts}-${idx}-${entry.rawType}`"
                  class="px-3 py-2 text-sm hover:bg-gray-750 cursor-pointer"
                  @click="toggleActivityEntry(idx)"
                >
                  <div class="flex items-start gap-2" :class="activityKindClass(entry)">
                    <span class="shrink-0">{{ entry.icon }}</span>
                    <span class="flex-1 break-words">{{ entry.summary }}</span>
                    <span class="text-xs text-gray-500 shrink-0">
                      {{ formatActivityTime(entry.ts) }}
                    </span>
                  </div>
                  <div
                    v-if="showActivityDetails || expandedActivity.has(idx)"
                    class="mt-2 pl-6 space-y-1"
                  >
                    <pre
                      v-if="entry.detail"
                      class="text-xs text-gray-200 bg-gray-900 border border-gray-700 rounded p-2 whitespace-pre-wrap break-words font-mono"
                    >{{ entry.detail }}</pre>
                    <pre
                      class="text-[11px] text-gray-500 bg-gray-900 border border-gray-700 rounded p-2 whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto"
                    >{{ formatRaw(entry.raw) }}</pre>
                    <p class="text-[10px] text-gray-600 font-mono">{{ entry.rawType }}</p>
                  </div>
                </li>
              </ul>
            </div>

            <!-- Activity log -->
            <div>
              <div class="flex justify-between items-center mb-2">
                <p class="text-xs uppercase tracking-wider text-gray-500">Activity</p>
                <label class="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" v-model="showAllDetails" class="accent-blue-500" />
                  Show details
                </label>
              </div>
              <div
                v-if="activityLoading && activityEntries.length === 0"
                class="text-sm text-gray-500 italic py-1"
              >
                No activity yet
              </div>
              <div
                v-else-if="activityEntries.length === 0"
                class="text-sm text-gray-500 italic py-1"
              >
                No activity yet
              </div>
              <ul v-else class="space-y-0.5">
                <li v-for="(entry, idx) in activityEntries" :key="idx">
                  <button
                    type="button"
                    @click="toggleEntry(idx)"
                    class="w-full text-left flex items-start gap-2 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                  >
                    <span class="flex-shrink-0 text-base leading-5 mt-px">{{ entry.icon }}</span>
                    <span :class="['text-sm flex-1 break-words leading-5', entryTextClass(entry)]">{{ entry.summary }}</span>
                    <span
                      v-if="entry.status"
                      :class="['text-xs px-1.5 py-0.5 rounded flex-shrink-0 self-start', entryBadgeClass(entry.status)]"
                    >
                      {{ entry.status }}
                    </span>
                  </button>
                  <div
                    v-if="showAllDetails || expandedEntries.has(idx)"
                    class="ml-8 mt-1 mb-1 space-y-2"
                  >
                    <pre
                      v-if="entry.detail"
                      class="text-sm text-gray-200 bg-gray-800 border border-gray-700 rounded p-2 whitespace-pre-wrap break-words"
                    >{{ entry.detail }}</pre>
                    <pre class="text-xs text-gray-500 bg-gray-950 border border-gray-800 rounded p-2 whitespace-pre-wrap break-words">{{ JSON.stringify(entry.raw, null, 2) }}</pre>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <p class="text-xs uppercase tracking-wider text-gray-500 mb-1">Result</p>
              <pre v-if="selectedTask.result" class="text-sm text-gray-100 bg-gray-800 border border-gray-700 rounded p-3 whitespace-pre-wrap break-words font-mono max-h-96 overflow-y-auto">{{ selectedTask.result }}</pre>
              <p v-else class="text-sm text-gray-500 italic">No result yet</p>
            </div>
          </template>
        </div>

        <div class="p-4 border-t border-gray-700 flex justify-between items-center">
          <button
            v-if="selectedTask && selectedTask.status === 'running'"
            type="button"
            @click="stopTask(selectedTask.task_id)"
            :disabled="stoppingTaskIds.has(selectedTask.task_id)"
            class="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded transition-colors"
          >
            {{ stoppingTaskIds.has(selectedTask.task_id) ? 'Stopping...' : 'Stop Task' }}
          </button>
          <span v-else></span>
          <button
            type="button"
            @click="closeTask"
            class="bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm px-4 py-2 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { apiFetch, authenticatedUrl } from '../lib/api'

interface Agent {
  slug: string
  name: string
  characterName?: string
  roleTitle?: string
  universe?: string
  status: 'idle' | 'working' | 'error'
  currentTask?: string
  currentTaskId?: string
  model?: string
}

interface AgentTask {
  task_id: string
  agent_slug: string
  description: string
  status: string
  result: string | null
  origin_channel: string | null
  started_at: string
  completed_at: string | null
}

const agents = ref<Agent[]>([])
const tasks = ref<AgentTask[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const stoppingTaskIds = ref<Set<string>>(new Set())

const selectedTaskId = ref<string | null>(null)
const selectedTask = ref<AgentTask | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

interface ActivityEntry {
  ts: number
  kind: 'message' | 'reasoning' | 'tool' | 'outcome' | 'system'
  icon: string
  summary: string
  detail?: string
  rawType: string
  raw: unknown
  toolCallId?: string
  status?: 'pending' | 'success' | 'error'
}

const activity = ref<ActivityEntry[]>([])
const activityLoading = ref(false)
const showActivityDetails = ref(false)
const expandedActivity = ref<Set<number>>(new Set())
let activityEventSource: EventSource | null = null
let activityRefreshTimer: ReturnType<typeof setTimeout> | null = null

let refreshInterval: ReturnType<typeof setInterval> | null = null

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

const formatDateTime = (value: string) => {
  if (!value) return ''
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

const statusBadgeClass = (status: string) => {
  switch (status) {
    case 'running': return 'bg-blue-900 text-blue-100'
    case 'done': return 'bg-green-900 text-green-100'
    case 'failed': return 'bg-red-900 text-red-100'
    case 'cancelled': return 'bg-yellow-900 text-yellow-100'
    default: return 'bg-gray-700 text-gray-200'
  }
}

const durationLabel = computed(() => {
  if (!selectedTask.value) return null
  const start = selectedTask.value.started_at
  const end = selectedTask.value.completed_at
  if (!start || !end) return null
  const startMs = new Date(start.includes('T') ? start : start.replace(' ', 'T') + 'Z').getTime()
  const endMs = new Date(end.includes('T') ? end : end.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
})

const stopTask = async (taskId: string) => {
  if (stoppingTaskIds.value.has(taskId)) return
  stoppingTaskIds.value = new Set(stoppingTaskIds.value).add(taskId)
  try {
    await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' })
    await refreshAll()
    if (selectedTaskId.value === taskId) {
      await loadTaskDetail(taskId)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to stop task'
  } finally {
    const next = new Set(stoppingTaskIds.value)
    next.delete(taskId)
    stoppingTaskIds.value = next
  }
}

const refreshAgents = async () => {
  try {
    const response = await apiFetch('/api/agents')
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = (await response.json()) as { agents: Agent[] }
    agents.value = data.agents
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load agents'
  }
}

const refreshTasks = async () => {
  try {
    const response = await apiFetch('/api/tasks?limit=50')
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = (await response.json()) as { tasks: AgentTask[] }
    tasks.value = data.tasks
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load tasks'
  }
}

const refreshAll = async () => {
  loading.value = true
  error.value = null
  try {
    await Promise.all([refreshAgents(), refreshTasks()])
  } finally {
    loading.value = false
  }
}

const loadTaskDetail = async (taskId: string) => {
  detailLoading.value = true
  detailError.value = null
  try {
    const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = (await response.json()) as { task: AgentTask }
    selectedTask.value = data.task
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : 'Failed to load task'
    selectedTask.value = null
  } finally {
    detailLoading.value = false
  }
}

const formatActivityTime = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

const formatRaw = (raw: unknown) => {
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

const activityKindClass = (entry: ActivityEntry) => {
  if (entry.status === 'success') return 'text-green-300'
  if (entry.status === 'error') return 'text-red-300'
  if (entry.status === 'pending') return 'text-blue-300'
  switch (entry.kind) {
    case 'message': return 'text-gray-100'
    case 'reasoning': return 'text-purple-300'
    case 'tool': return 'text-blue-200'
    case 'outcome': return 'text-yellow-200'
    default: return 'text-gray-300'
  }
}

const toggleActivityEntry = (idx: number) => {
  if (showActivityDetails.value) return
  const next = new Set(expandedActivity.value)
  if (next.has(idx)) next.delete(idx)
  else next.add(idx)
  expandedActivity.value = next
}

const loadActivity = async (taskId: string, opts: { initial?: boolean } = {}) => {
  if (opts.initial) activityLoading.value = true
  try {
    const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/activity`)
    if (!response.ok) return
    const data = (await response.json()) as { activity: ActivityEntry[] }
    activity.value = data.activity ?? []
  } catch {
    // Non-fatal — activity is best-effort.
  } finally {
    if (opts.initial) activityLoading.value = false
  }
}

const scheduleActivityRefresh = (taskId: string) => {
  if (activityRefreshTimer) return
  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null
    if (selectedTaskId.value === taskId) loadActivity(taskId)
  }, 250)
}

const startActivityStream = (taskId: string) => {
  stopActivityStream()
  loadActivity(taskId, { initial: true })
  try {
    activityEventSource = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events`)
    activityEventSource.onmessage = () => {
      // Coalesce bursts of SSE events into one refetch every 250ms.
      scheduleActivityRefresh(taskId)
    }
    activityEventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    }
  } catch {
    activityEventSource = null
  }
}

const stopActivityStream = () => {
  if (activityEventSource) {
    activityEventSource.close()
    activityEventSource = null
  }
  if (activityRefreshTimer) {
    clearTimeout(activityRefreshTimer)
    activityRefreshTimer = null
  }
}

const openTask = (taskId: string) => {
  selectedTaskId.value = taskId
  selectedTask.value = null
  activity.value = []
  expandedActivity.value = new Set()
  loadTaskDetail(taskId)
  startActivityStream(taskId)
}

const closeTask = () => {
  selectedTaskId.value = null
  selectedTask.value = null
  detailError.value = null
  activity.value = []
  expandedActivity.value = new Set()
  stopActivityStream()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && selectedTaskId.value) closeTask()
}

watch(selectedTaskId, (val) => {
  if (val) {
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onMounted(() => {
  refreshAll()
  refreshInterval = setInterval(refreshAll, 5000)
})

watch(
  () => selectedTask.value?.status,
  (status) => {
    if (status && status !== 'running') {
      // Final refresh once, then stop the stream — no more updates expected.
      if (selectedTaskId.value) loadActivity(selectedTaskId.value)
      stopActivityStream()
    }
  }
)

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  document.removeEventListener('keydown', onKeydown)
  stopActivityStream()
})
</script>

<style scoped>
.bg-gray-750 {
  background-color: rgb(45, 55, 72);
}
</style>
