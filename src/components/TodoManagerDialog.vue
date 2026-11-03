<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ListTodo, Pencil, Plus, Trash2, X } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  createTodo,
  deleteTodo,
  listTodos,
  setTodoDone,
  updateTodo,
} from "../lib/db";
import type { Project, Todo } from "../types";

// Global todo list, opened from the header "Todos" button (visible on
// every tab, including Quick Access — that is the quick access to
// todos) and from a project's context menu filtered to that project.
// A todo is global by default; linking it to a project is optional
// and only affects filtering — deleting a project unlinks, never
// deletes, its todos. Done todos sort below open ones.
const props = defineProps<{
  projects: Project[];
  initialProjectId: number | null;
}>();
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const todos = ref<Todo[]>([]);
// Filter as a string ("all" / "none" / project id) so the select's
// v-model never mixes string and number types.
const filterValue = ref<string>(
  props.initialProjectId != null ? String(props.initialProjectId) : "all",
);
const newTitle = ref("");
const newNotes = ref("");
const newProjectId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const editTitle = ref("");
const editNotes = ref("");
const editProjectId = ref<number | null>(null);

function projectName(id: number | null): string {
  if (id == null) return "No project";
  return props.projects.find((p) => p.id === id)?.name ?? "Deleted project";
}

const filtered = computed(() => {
  if (filterValue.value === "all") return todos.value;
  if (filterValue.value === "none")
    return todos.value.filter((t) => t.projectId == null);
  return todos.value.filter((t) => t.projectId === Number(filterValue.value));
});
const openCount = computed(() => todos.value.filter((t) => !t.done).length);

async function refresh() {
  todos.value = await listTodos();
}

async function add() {
  const title = newTitle.value.trim();
  if (!title) return;
  await createTodo(title, newNotes.value.trim(), newProjectId.value);
  newTitle.value = "";
  newNotes.value = "";
  newProjectId.value = null;
  await refresh();
}

async function toggleDone(todo: Todo) {
  await setTodoDone(todo.id, !todo.done);
  await refresh();
}

async function remove(todo: Todo) {
  await deleteTodo(todo.id);
  await refresh();
  showToast("Todo deleted.");
}

function startEdit(todo: Todo) {
  editingId.value = todo.id;
  editTitle.value = todo.title;
  editNotes.value = todo.notes;
  editProjectId.value = todo.projectId;
}

async function saveEdit(todo: Todo) {
  const title = editTitle.value.trim();
  if (!title) return;
  await updateTodo(todo.id, title, editNotes.value.trim(), editProjectId.value);
  editingId.value = null;
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div ref="dialogPanel" class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-4 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <ListTodo class="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" /> Todos
        <span class="text-sm font-normal text-neutral-500">
          {{ openCount }} open
        </span>
        <button class="ml-auto rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </h2>

      <div class="mb-4 flex flex-wrap items-center gap-2">
        <label class="text-xs text-neutral-500" for="todo-filter">Show</label>
        <select
          id="todo-filter"
          v-model="filterValue"
          class="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="all">All todos</option>
          <option value="none">No project</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>

      <ul class="mb-4 max-h-80 space-y-1 overflow-y-auto pr-1">
        <li
          v-for="todo in filtered"
          :key="todo.id"
          class="rounded-lg px-2 py-1.5 text-sm"
          :class="todo.done ? 'opacity-60' : ''"
        >
          <template v-if="editingId === todo.id">
            <input
              v-model="editTitle"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              @keyup.enter="saveEdit(todo)"
            />
            <textarea
              v-model="editNotes"
              rows="2"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Notes (optional)"
            />
            <span class="flex gap-2">
              <select
                v-model="editProjectId"
                class="flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option :value="null">No project</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
              <button class="btn btn-primary btn-sm" :disabled="!editTitle.trim()" @click="saveEdit(todo)">Save</button>
              <button class="btn btn-ghost btn-sm" @click="editingId = null">Cancel</button>
            </span>
          </template>
          <template v-else>
            <span class="flex items-start gap-2">
              <input
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                :checked="todo.done"
                @change="toggleDone(todo)"
              />
              <span class="min-w-0 flex-1">
                <span class="block font-medium" :class="todo.done ? 'line-through' : ''">
                  {{ todo.title }}
                </span>
                <span v-if="todo.notes" class="block whitespace-pre-wrap text-xs text-neutral-500">
                  {{ todo.notes }}
                </span>
                <span class="block text-xs text-neutral-400">
                  {{ projectName(todo.projectId) }}
                </span>
              </span>
              <button class="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700" title="Edit todo" @click="startEdit(todo)">
                <Pencil class="h-4 w-4" />
              </button>
              <button class="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950" title="Delete todo" @click="remove(todo)">
                <Trash2 class="h-4 w-4" />
              </button>
            </span>
          </template>
        </li>
        <li v-if="!filtered.length" class="px-2 py-4 text-center text-sm text-neutral-500">
          No todos here yet.
        </li>
      </ul>

      <div class="mb-2 flex gap-2">
        <input
          v-model="newTitle"
          type="text"
          placeholder="New todo…"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="add"
        />
        <button
          class="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          :disabled="!newTitle.trim()"
          @click="add"
        >
          <Plus class="h-4 w-4" /> Add
        </button>
      </div>
      <div class="mb-5 flex gap-2">
        <input
          v-model="newNotes"
          type="text"
          placeholder="Notes (optional)"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="add"
        />
        <select
          v-model="newProjectId"
          class="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option :value="null">No project</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>

      <p class="mb-5 text-xs text-neutral-500">
        Todos are saved in the app database, so they survive restarts.
        Linking a todo to a project is optional — unlinked todos live
        in the global list, and deleting a project only unlinks its
        todos.
      </p>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
