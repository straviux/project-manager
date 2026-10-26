import { reactive } from "vue";

export interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

let nextId = 1;
export const toasts = reactive<Toast[]>([]);

/**
 * App-wide toast notifications (bottom-right stack, see Toasts.vue).
 * Success toasts fade away on their own after 4s; error toasts stay until
 * dismissed so an important failure can't scroll past unnoticed.
 */
export function showToast(
  message: string,
  kind: "success" | "error" = "success",
): void {
  const id = nextId++;
  toasts.push({ id, kind, message });
  if (kind === "success") setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
