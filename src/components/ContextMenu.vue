<script setup lang="ts">
import { computed, type Component } from "vue";

export interface ContextMenuItem {
  label: string;
  icon?: Component;
  danger?: boolean;
  action: () => void;
}

const props = defineProps<{
  x: number;
  y: number;
  items: ContextMenuItem[];
}>();
const emit = defineEmits<{ close: [] }>();

// Keep the menu inside the window when it opens near an edge.
const style = computed(() => {
  const width = 224;
  const height = props.items.length * 40 + 16;
  return {
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - height - 8))}px`,
  };
});

function choose(item: ContextMenuItem) {
  emit("close");
  item.action();
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60]"
    @click="emit('close')"
    @contextmenu.prevent="emit('close')"
  >
    <ul
      class="menu glass-panel fixed z-[60] w-56 rounded-box bg-base-200 p-2 text-sm shadow-xl ring-1 ring-white/10"
      :style="style"
      @click.stop
    >
      <li v-for="item in items" :key="item.label">
        <a :class="item.danger ? 'text-error' : ''" @click="choose(item)">
          <component :is="item.icon" v-if="item.icon" class="h-4 w-4 shrink-0" />
          {{ item.label }}
        </a>
      </li>
    </ul>
  </div>
</template>
