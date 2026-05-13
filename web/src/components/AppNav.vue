<template>
  <nav v-if="route.name !== 'login'" class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
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
            to="/schedules"
            class="block px-4 py-2 rounded hover:bg-gray-800 transition-colors"
            :class="{ 'bg-blue-900 text-blue-300': route.name === 'schedules' }"
          >
            📅 Schedules
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

    <div v-if="auth.authEnabled && auth.user" class="p-4 border-t border-gray-800">
      <p class="text-xs text-gray-500 truncate mb-2">{{ auth.user.email }}</p>
      <button
        @click="handleSignOut"
        class="w-full px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
      >
        Sign out
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

async function handleSignOut() {
  await auth.signOut()
  router.push('/login')
}
</script>
