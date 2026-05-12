<template>
  <nav class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
    <div class="p-6 border-b border-gray-800">
      <h1 class="text-xl font-bold text-blue-400">IO</h1>
      <p class="text-xs text-gray-500">Terminal Assistant</p>
    </div>
    
    <div class="flex-1 py-6">
      <ul class="space-y-2 px-3">
        <li>
          <RouterLink
            to="/chat"
            class="block px-4 py-2 rounded hover:bg-gray-800 transition-colors"
            :class="{ 'bg-blue-900 text-blue-300': route.name === 'chat' }"
          >
            💬 Chat
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/skills"
            class="block px-4 py-2 rounded hover:bg-gray-800 transition-colors"
            :class="{ 'bg-blue-900 text-blue-300': route.name === 'skills' }"
          >
            ⚙️ Skills
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/squads"
            class="block px-4 py-2 rounded hover:bg-gray-800 transition-colors"
            :class="{ 'bg-blue-900 text-blue-300': route.name === 'squads' }"
          >
            👥 Squads
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/activity"
            class="block px-4 py-2 rounded hover:bg-gray-800 transition-colors"
            :class="{ 'bg-blue-900 text-blue-300': route.name === 'activity' }"
          >
            📊 Activity
          </RouterLink>
        </li>
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { RouterLink } from 'vue-router'

const route = useRoute()
</script>

<style scoped>
</style>
