import type { Dialog, DialogId } from "./types";

/**
 * Dialog state available via useDialogState selector.
 */
export interface DialogState {
  /** Whether any dialog is currently open. */
  isOpen: boolean;
  /** Array of all active dialogs (oldest first). */
  dialogs: readonly Dialog[];
  /** The top-most (most recent) dialog, or undefined if none. */
  topDialog: Dialog | undefined;
  /** Number of currently open dialogs. */
  count: number;
}

/**
 * Context for a generic prompt dialog.
 * Call `resolve(value)` to complete with a value, or `dismiss()` to cancel.
 * @template T The type of value the prompt resolves to.
 */
export interface PromptContext<T> {
  /** Resolves the Promise with the given value and closes the dialog. */
  resolve: (value: T) => void;
  /** Dismisses the dialog without a value. Resolves Promise with `undefined`. */
  dismiss: () => void;
  /** The unique ID of this dialog. Use with `useDialogKeyboard` for scoped keyboard handling. */
  dialogId: DialogId;
}
