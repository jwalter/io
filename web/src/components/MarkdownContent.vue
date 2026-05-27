<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";

const props = defineProps<{ content: string }>();

const rendered = computed(() => {
  if (!props.content) return "";
  return marked.parse(props.content, { async: false }) as string;
});
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none" v-html="rendered"></div>
</template>
