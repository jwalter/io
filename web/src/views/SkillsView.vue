<template>
  <div class="flex flex-col h-full bg-gray-950">
    <div class="flex-1 overflow-y-auto p-6">
      <h2 class="text-2xl font-bold mb-6">Skills</h2>

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

onMounted(async () => {
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
})
</script>

<style scoped>
</style>
