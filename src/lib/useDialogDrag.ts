import { onUnmounted, watch, type Ref } from "vue";

/**
 * Make a dialog draggable by its title bar.
 *
 * This deliberately uses pointer events, not HTML5 drag-and-drop, for
 * the same reason the project-card and Files drags do: HTML5 drag
 * never engages in this Tauri webview, while pointer/mouse events do.
 * The behaviour mirrors PrimeVue Dialog's drag (drag by the header,
 * keep the dialog in the viewport), without restyling every dialog
 * as a PrimeVue Dialog.
 *
 * Usage in a dialog component:
 *   const dialogPanel = ref<HTMLElement | null>(null);
 *   const dialogHandle = ref<HTMLElement | null>(null);
 *   useDialogDrag(dialogPanel, dialogHandle);
 * with ref="dialogPanel" on the panel element and ref="dialogHandle"
 * on its title row, plus `cursor-grab` on the handle for the affordance.
 *
 * The handle's interactive children (close button, open-in-app button,
 * …) are excluded, so clicking them still works. Dragging never
 * triggers the overlay's @click.self close, because the pointer is
 * over the panel, not the overlay.
 */
export function useDialogDrag(
  panel: Ref<HTMLElement | null>,
  handle: Ref<HTMLElement | null>,
): void {
  let cleanup: (() => void) | null = null;

  const attach = (panelEl: HTMLElement, handleEl: HTMLElement) => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Never start a drag from a control inside the title bar.
      if (
        (event.target as HTMLElement).closest(
          "button, a, input, select, textarea, label",
        )
      )
        return;

      // Take the panel out of the centered flex layout at its current
      // position, then move it in fixed coordinates. Width is frozen
      // so the panel does not shrink once it leaves the flex row.
      const startRect = panelEl.getBoundingClientRect();
      panelEl.style.position = "fixed";
      panelEl.style.left = `${startRect.left}px`;
      panelEl.style.top = `${startRect.top}px`;
      panelEl.style.margin = "0";
      panelEl.style.width = `${startRect.width}px`;

      let lastX = event.clientX;
      let lastY = event.clientY;
      document.body.classList.add("select-none");

      const onPointerMove = (move: PointerEvent) => {
        const dx = move.clientX - lastX;
        const dy = move.clientY - lastY;
        lastX = move.clientX;
        lastY = move.clientY;
        const rect = panelEl.getBoundingClientRect();
        // Keep at least 100px of the panel horizontally and the whole
        // title bar vertically on screen, so it can always be grabbed
        // again to drag it back.
        const left = Math.max(
          -(rect.width - 100),
          Math.min(rect.left + dx, window.innerWidth - 100),
        );
        const top = Math.max(
          0,
          Math.min(rect.top + dy, window.innerHeight - 40),
        );
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.classList.remove("select-none");
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    };

    handleEl.addEventListener("pointerdown", onPointerDown);
    return () => handleEl.removeEventListener("pointerdown", onPointerDown);
  };

  // Dialogs are v-if mounted (and FilesView's inline dialogs appear
  // after that component mounts), so watch for both refs becoming
  // available instead of attaching once in onMounted.
  const stop = watch(
    [panel, handle],
    ([panelEl, handleEl]) => {
      cleanup?.();
      cleanup = null;
      if (panelEl && handleEl) cleanup = attach(panelEl, handleEl);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    cleanup?.();
    stop();
    document.body.classList.remove("select-none");
  });
}
