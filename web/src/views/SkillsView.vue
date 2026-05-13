<template>
  <div class="flex flex-col h-full bg-gray-950">
    <div class="flex-1 overflow-y-auto p-6">
      <h2 class="text-2xl font-bold mb-6">Skills</h2>

      <!-- Add Skill form -->
      <form @submit.prevent="installSkill" class="mb-6 max-w-2xl">
        <div class="flex gap-2">
          <input
            v-model="newRepoUrl"
            type="url"
            placeholder="https://github.com/owner/repo.git"
            aria-label="Git repository URL"
            :disabled="installing"
            class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            :disabled="installing || newRepoUrl.trim() === ''"
            class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm transition-colors whitespace-nowrap"
          >
            {{ installing ? 'Installing…' : 'Install' }}
          </button>
        </div>
      </form>

      <!-- Install feedback banners -->
      <div v-if="installSuccess" class="bg-green-900 text-green-100 p-4 rounded-lg mb-4">
        {{ installSuccess }}
      </div>
      <div v-if="installError" class="bg-red-900 text-red-100 p-4 rounded-lg mb-4">
        {{ installError }}
      </div>

      <!-- Skills list -->
      <div v-if="loading" class="text-gray-400 text-center py-12">
        Loading skills...
      </div>

      <div v-else-if="error" class="bg-red-900 text-red-100 p-4 rounded-lg mb-4">
        {{ error }}
      </div>

      <div v-else-if="skills.length === 0" class="text-gray-400 text-center py-12">
        No skills available
      </div>

      <div v-else class="grid gap-4">
        <div
          v-for="skill in skills"
          :key="skill.slug"
          class="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-blue-500 transition-colors"
        >
          <div class="flex justify-between items-start mb-2">
            <div>
              <h3 class="font-bold text-gray-100">{{ skill.name }}</h3>
              <p class="text-sm text-gray-500">{{ skill.slug }}</p>
            </div>
          </div>
          <p class="text-sm text-gray-400 mb-3">{{ skill.description }}</p>
          <p class="text-xs text-gray-500">{{ skill.path }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiFetch } from '../lib/api'

interface Skill {
  name: string
  slug: string
  description: string
  path: string
}

const skills = ref<Skill[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const newRepoUrl = ref<string>('')
const installing = ref(false)
const installError = ref<string | null>(null)
const installSuccess = ref<string | null>(null)

async function fetchSkills(): Promise<void> {
  try {
    const response = await apiFetch('/api/skills')
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = (await response.json()) as { skills: Skill[] }
    skills.value = data.skills
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load skills'
  } finally {
    loading.value = false
  }
}

async function installSkill(): Promise<void> {
  if (installing.value || newRepoUrl.value.trim() === '') return
  installing.value = true
  installError.value = null
  installSuccess.value = null

  try {
    const response = await apiFetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: newRepoUrl.value.trim() }),
    })

    if (response.ok) {
      const data = (await response.json()) as { skill: Skill }
      // Optimistic prepend for instant feedback while refetch is in flight
      skills.value = [data.skill, ...skills.value]
      newRepoUrl.value = ''
      installSuccess.value = `✓ Installed: ${data.skill.name}`
      setTimeout(() => { installSuccess.value = null }, 4000)
      // Refetch so dedup/ordering from the server takes effect
      void fetchSkills()
    } else {
      let message = 'Install failed'
      try {
        const body = (await response.json()) as { error?: string }
        message = body.error ?? response.statusText ?? message
      } catch {
        message = response.statusText || message
      }
      installError.value = message
    }
  } catch (e) {
    installError.value = e instanceof Error ? e.message : 'Install failed'
  } finally {
    installing.value = false
  }
}

onMounted(fetchSkills)
</script>

<style scoped>
</style>
