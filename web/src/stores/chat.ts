import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<Message[]>([])
  const isLoading = ref(false)

  function addMessage(role: 'user' | 'assistant', content: string) {
    const message: Message = {
      id: Math.random().toString(36).substring(7),
      role,
      content,
      timestamp: new Date(),
    }
    messages.value.push(message)
    return message
  }

  function updateLastMessage(content: string) {
    if (messages.value.length > 0) {
      messages.value[messages.value.length - 1].content = content
    }
  }

  function clearMessages() {
    messages.value = []
  }

  return {
    messages,
    isLoading,
    addMessage,
    updateLastMessage,
    clearMessages,
  }
})
