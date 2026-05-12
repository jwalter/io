import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const version = ref('0.1.0')

  return {
    version,
  }
})
