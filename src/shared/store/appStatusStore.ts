import { create } from 'zustand';

/**
 * App-wide transient status: the error banner message and the brief
 * auto-dismissing confirmation toast. Centralized here so any feature component
 * or hook can report an error / show a toast without prop-drilling onError /
 * showToast callbacks down from the page.
 *
 * Both pieces are ephemeral UI (never persisted), so a module-level singleton is
 * appropriate. The toast auto-dismiss timer lives at module scope, mirroring the
 * ref the page used previously.
 */
type ToastPosition = { x: number; y: number } | null;

// Structural subset of MouseEvent so callers can pass a React or DOM mouse event.
type PointerLike = { clientX: number; clientY: number };

type UndoOffer = { message: string; onUndo: () => void } | null;

type AppStatusStore = {
 error: string;
 setError: (message: string) => void;
 toast: string;
 toastPos: ToastPosition;
 /**
  * Show a brief (~1s) confirmation toast. Pass a mouse event to anchor it near
  * the click; omit for the default bottom-center position.
  */
 showToast: (message: string, event?: PointerLike) => void;
 undo: UndoOffer;
 /**
  * Offer a ~6s undo window after a destructive action (e.g. a delete). Replaces
  * any pending offer — only the most recent destructive action is undoable.
  */
 showUndo: (message: string, onUndo: () => void) => void;
 clearUndo: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStatusStore = create<AppStatusStore>((set) => ({
 error: '',
 setError: (message) => set({ error: message }),
 toast: '',
 toastPos: null,
 showToast: (message, event) => {
  set({ toast: message, toastPos: event ? { x: event.clientX, y: event.clientY } : null });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: '' }), 1000);
 },
 undo: null,
 showUndo: (message, onUndo) => {
  set({ undo: { message, onUndo } });
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => set({ undo: null }), 6000);
 },
 clearUndo: () => {
  if (undoTimer) clearTimeout(undoTimer);
  set({ undo: null });
 },
}));
