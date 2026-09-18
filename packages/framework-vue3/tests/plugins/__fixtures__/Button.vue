<script setup lang="ts">
defineProps<{
  /** The label of the button */
  label: string
  size?: 'small' | 'large'
}>()
defineEmits<{ click: [id: number] }>()
</script>

<template>
  <button @click="$emit('click', 1)">{{ label }}</button>
</template>
