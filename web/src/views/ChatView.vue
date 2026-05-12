<template>
  <div class="flex flex-col h-full bg-gray-950">
    <!-- Messages container -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
      <div v-if="messages.length === 0" class="flex items-center justify-center h-full">
        <div class="text-center">
          <p class="text-gray-400 mb-2">No messages yet</p>
          <p class="text-sm text-gray-500">Start a conversation below</p>
        </div>
      </div>

      <div v-for="msg in messages" :key="msg.id" :class="[
        'flex',
        msg.role === 'user' ? 'justify-end' : 'justify-start'
      ]">
        <div :class="[
          'max-w-md px-4 py-2 rounded-lg',
          msg.role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100'
        ]">
          <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
          <p :class="[
            'text-xs mt-1',
            msg.role === 'user' ? 'text-blue-100' : 'text-gray-500'
          ]">
            {{ formatTime(msg.timestamp) }}
          </p>
        </div>
      </div>

      <!-- Loading indicator -->
      <div v-if="isLoading" class="flex justify-start">
        <div class="bg-gray-800 text-gray-100 px-4 py-2 rounded-lg">
          <div class="flex space-x-2">
            <div class="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.1s"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.2s"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="border-t border-gray-800 p-6 bg-gray-900">
      <form @submit.prevent="sendMessage" class="flex gap-3">
        <input
          v-model="inputMessage"
          :disabled="isLoading"
          type="text"
          placeholder="Type your message..."
          class="flex-1 bg-gray-800 text-gray-100 rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          :disabled="isLoading || !inputMessage.trim()"
          class="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white px-6 py-2 rounded transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUpdated } from 'vue'
import { useChatStore } from '../stores/chat'

const chatStore = useChatStore()
const inputMessage = ref('')
const messagesContainer = ref<HTMLElement>()

const messages = computed(() => chatStore.messages)
const isLoading = computed(() => chatStore.isLoading)

const formatTime = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date)
}

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

onUpdated(() => {
  scrollToBottom()
})

const sendMessage = async () => {
  const message = inputMessage.value.trim()
  if (!message) return

  // Add user message to chat
  chatStore.addMessage('user', message)
  inputMessage.value = ''

  // Add assistant message and start streaming
  const assistantMsg = chatStore.addMessage('assistant', '')
  chatStore.isLoading = true

  try {
    // Send message to backend
    const response = await fetch('/api/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: message }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Connect to SSE for streaming response
    const eventSource = new EventSource('/api/events')
    let buffer = ''

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.type === 'delta' && data.text) {
          buffer += data.text
          chatStore.updateLastMessage(buffer)
        } else if (data.type === 'done') {
          eventSource.close()
          chatStore.isLoading = false
        }
      } catch (e) {
        console.error('Error parsing SSE message:', e)
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
      chatStore.isLoading = false
    }
  } catch (error) {
    console.error('Error sending message:', error)
    chatStore.updateLastMessage('Error: Failed to send message')
    chatStore.isLoading = false
  }
}
</script>

<style scoped>
</style>
