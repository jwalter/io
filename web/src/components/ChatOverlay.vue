<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { useChatStore } from "@/stores/chat";
import { useRoute } from "vue-router";
import { MessageCircle, X, Send, Square, Minimize2 } from "lucide-vue-next";
import MarkdownContent from "@/components/MarkdownContent.vue";

const chat = useChatStore();
const route = useRoute();
const isOpen = ref(false);
const input = ref("");
const messagesContainer = ref<HTMLElement>();

// Don't show overlay on the Chat page itself
const isOnChatPage = () => route.path === "/";

function toggle() {
  if (isOnChatPage()) return;
  isOpen.value = !isOpen.value;
}

async function send() {
  const text = input.value.trim();
  if (!text || chat.isStreaming) return;
  input.value = "";
  await chat.sendMessage(text);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(
  () => chat.messages.map((m) => m.content),
  async () => {
    await nextTick();
    scrollToBottom();
  },
  { deep: true }
);

watch(
  () => chat.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);
</script>

<template>
  <!-- FAB button -->
  <button
    v-if="!isOpen && !isOnChatPage()"
    @click="toggle"
    class="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full btn-gradient flex items-center justify-center shadow-glow-lg hover:scale-105 transition-transform"
    title="Chat with IO"
  >
    <MessageCircle class="w-5 h-5 text-white" />
  </button>

  <!-- Chat panel -->
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-4 scale-95"
    enter-to-class="opacity-100 translate-y-0 scale-100"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0 scale-100"
    leave-to-class="opacity-0 translate-y-4 scale-95"
  >
    <div
      v-if="isOpen"
      class="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-header">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
          <span class="text-sm font-medium">IO Assistant</span>
        </div>
        <button
          @click="isOpen = false"
          class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Minimize2 class="w-4 h-4" />
        </button>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto p-3 space-y-3">
        <div v-if="chat.messages.length === 0" class="flex items-center justify-center h-full">
          <p class="text-xs text-muted-foreground">Send a message to chat with IO</p>
        </div>

        <div
          v-for="msg in chat.messages"
          :key="msg.id"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[80%] rounded-lg px-3 py-2 text-xs"
            :class="
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-foreground'
            "
          >
            <MarkdownContent v-if="msg.content" :content="msg.content" :class="msg.role === 'user' ? 'prose-invert' : ''" />
            <span v-else class="text-muted-foreground">...</span>
            <div
              v-if="msg.streaming"
              class="inline-block w-1.5 h-3 bg-current animate-pulse ml-1"
            ></div>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="border-t border-border p-3">
        <div class="flex gap-2 items-end">
          <textarea
            v-model="input"
            @keydown="handleKeydown"
            placeholder="Message IO..."
            rows="1"
            class="flex-1 resize-none rounded-md border border-input bg-input px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[80px]"
          ></textarea>
          <button
            @click="send"
            :disabled="!input.trim() || chat.isStreaming"
            class="rounded-md bg-primary text-primary-foreground p-2 hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send v-if="!chat.isStreaming" class="w-3.5 h-3.5" />
            <Square v-else class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
