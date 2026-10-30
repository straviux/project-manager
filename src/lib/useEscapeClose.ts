import { onMounted, onUnmounted } from "vue";

/**
 * Close a modal with the Escape key.
 *
 * Usage in a dialog component:
 *   useEscapeClose(() => emit("close"));
 * (ConfirmDialog passes () => emit("cancel") instead.)
 *
 * Modals can stack (e.g. a ConfirmDialog over the history dialog, or
 * a picker over the Files view), so callbacks live in a module-level
 * stack in mount order. On Escape, only the topmost callback runs:
 * if it reports that it handled the key (anything other than false),
 * lower modals stay open, so one Escape closes one modal, not all of
 * them. A callback that has nothing open (App history, FilesView's
 * inline dialogs) returns false, letting the key fall through to
 * whatever is underneath.
 *
 * The listener is registered on mount and removed on unmount, so a
 * closed dialog never keeps intercepting Escape.
 */
type EscapeHandler = () => boolean | void;

const stack: EscapeHandler[] = [];

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]() !== false) break;
  }
}

export function useEscapeClose(onEscape: EscapeHandler): void {
  onMounted(() => {
    if (stack.length === 0) {
      window.addEventListener("keydown", onKeyDown);
    }
    stack.push(onEscape);
  });
  onUnmounted(() => {
    const index = stack.indexOf(onEscape);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) {
      window.removeEventListener("keydown", onKeyDown);
    }
  });
}
