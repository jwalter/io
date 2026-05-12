<template>
  <div class="flex flex-col h-full">
    <!-- Message history -->
    <div ref="messagesEl" class="flex-1 overflow-y-auto p-6 space-y-4">
      <div v-if="store.messages.length === 0" class="text-gray-600 text-sm text-center mt-12">
        Send a message to start chatting with IO
      </div>

      <div
        v-for="msg in store.messages"
        :key="msg.id"
        class="flex"
        :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[75%] px-4 py-3 rounded-lg text-sm whitespace-pre-wrap"
          :class="
            msg.role === 'user'
              ? 'bg-blue-700 text-white'
              : 'bg-gray-800 text-gray-100 border border-gray-700'
          "
        >
          <span>{{ msg.content }}</span>
          <span v-if="msg.streaming" class="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse" />
        </div>
      </div>

      <!-- Thinking indicator -->
      <div v-if="store.isLoading && !isStreaming" class="flex justify-start">
        <div class="bg-gray-800 border border-gray-700 px-4 py-3 rounded-lg text-sm text-gray-400 flex gap-1">
          <span class="animate-bounce" style="animation-delay: 0ms">·</span>
          <span class="animate-bounce" style="animation-delay: 150ms">·</span>
          <span class="animate-bounce" style="animation-delay: 300ms">·</span>
        </div>
      </div>
    </div>

    <!-- Input bar -->
    <div class="border-t border-gray-800 p-4">
      <form @submit.prevent="sendMessage" class="flex gap-3">
        <input
          v-model="input"
          type="text"
          placeholder="Message IO..."
          :disabled="store.isLoading"
          class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          :disabled="store.isLoading || !input.trim()"
          class="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const input = ref('')
const messagesEl = ref<HTMLElement | null>(null)

const isStreaming = computed(() =>
  store.messages.some((m) => m.streaming)
)

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

watch(() => store.messages.length, scrollToBottom)

async function sendMessage() {
  const text = input.value.trim()
  if (!text || store.isLoading) return

  input.value = ''
  store.isLoading = true

  store.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
  store.addMessage({ id: crypto.randomUUID(), role: 'assistant', content: '', streaming: true })

  scrollToBottom()

  // Open SSE stream for real-time deltas
  const evtSource = new EventSource('/api/events')
  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as { type: 'delta' | 'done'; text: string }
      if (data.type === 'delta') {
        store.appendToLast(data.text)
        scrollToBottom()
      } else if (data.type === 'done') {
        store.setLastStreaming(false)
        store.isLoading = false
        evtSource.close()
        scrollToBottom()
      }
    } catch {
      // ignore parse errors
    }
  }
  evtSource.onerror = () => {
    store.setLastStreaming(false)
    store.isLoading = false
    evtSource.close()
  }

  // Send message — response includes full text but SSE deltas are primary UX
  try {
    await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    store.appendToLast('\n\n[Error: failed to reach IO]')
    store.setLastStreaming(false)
    store.isLoading = false
    evtSource.close()
  }
}
</script>
