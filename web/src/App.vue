<template>
  <div class="flex h-screen bg-gray-950">
    <AppNav />
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import AppNav from './components/AppNav.vue'
import { RouterView } from 'vue-router'
</script>

<style scoped>
</style>
