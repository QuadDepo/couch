import type { Renderable, RenderContext } from "@opentui/core";
import type { PromptContext } from "./prompts";
import type { Dialog, DialogId, DialogShowOptions, DialogToClose } from "./types";

type DialogSubscriber = (data: Dialog | DialogToClose) => void;

/**
 * Extended DialogShowOptions for async dialog factory functions.
 * @template T The type of value returned on dismiss.
 */
export interface AsyncShowOptions<T> extends DialogShowOptions {
  /** Fallback value when dialog is dismissed via ESC or backdrop click. */
  fallback?: T;
}

/**
 * Manages dialog state and lifecycle for a DialogContainerRenderable.
 *
 * @example
 * ```ts
 * const manager = new DialogManager(renderer);
 * const container = new DialogContainerRenderable(renderer, { manager });
 *
 * manager.show({
 *   content: (ctx) => new TextRenderable(ctx, { content: "Hello" }),
 * });
 * ```
 */
export class DialogManager {
  private dialogs: Dialog[] = [];
  private subscribers = new Set<DialogSubscriber>();
  private idCounter = 1;
  private savedFocus: Renderable | null = null;
  private ctx: RenderContext;
  private focusRestoreTimeout?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }

  private saveFocus(): void {
    this.cancelPendingFocusRestore();
    this.savedFocus = this.ctx.currentFocusedRenderable;
    this.savedFocus?.blur();
  }

  private cancelPendingFocusRestore(): void {
    if (this.focusRestoreTimeout) {
      clearTimeout(this.focusRestoreTimeout);
      this.focusRestoreTimeout = undefined;
    }
  }

  private restoreFocus(): void {
    this.cancelPendingFocusRestore();

    if (this.savedFocus && !this.savedFocus.isDestroyed) {
      // Defer to next tick to ensure dialog is fully removed from render tree
      this.focusRestoreTimeout = setTimeout(() => {
        if (!this.destroyed && this.savedFocus && !this.savedFocus.isDestroyed) {
          this.savedFocus.focus();
        }
        this.savedFocus = null;
        this.focusRestoreTimeout = undefined;
      }, 1);
    } else {
      this.savedFocus = null;
    }
  }

  /** Subscribe to dialog state changes. Returns an unsubscribe function. */
  subscribe(subscriber: DialogSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private publish(data: Dialog | DialogToClose): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(data);
      } catch (error) {
        console.error("[@opentui-ui/dialog] Subscriber threw an error:", error);
      }
    }
  }

  private addDialog(data: Dialog): void {
    this.dialogs = [...this.dialogs, data];
    this.publish(data);
  }

  /** Show a new dialog. */
  show(options: DialogShowOptions): DialogId {
    if (this.destroyed) {
      throw new Error("[@opentui-ui/dialog] Cannot show dialog: DialogManager has been destroyed.");
    }

    if (typeof options.content !== "function") {
      throw new Error(
        "[@opentui-ui/dialog] Missing or invalid 'content': expected a factory function.",
      );
    }

    const id = options.id !== undefined && options.id !== null ? options.id : this.idCounter++;

    const existingIndex = this.dialogs.findIndex((d) => d.id === id);

    if (existingIndex !== -1) {
      const existing = this.dialogs[existingIndex];
      if (existing) {
        const updated: Dialog = { ...existing, ...options, id };
        this.dialogs = [
          ...this.dialogs.slice(0, existingIndex),
          updated,
          ...this.dialogs.slice(existingIndex + 1),
        ];
        this.publish(updated);
      }
    } else {
      if (this.dialogs.length === 0) {
        this.saveFocus();
      }

      const dialog: Dialog = {
        ...options,
        id,
      };
      this.addDialog(dialog);
      dialog.onOpen?.();
    }

    return id;
  }

  /** Close a dialog by ID, or the top-most dialog if no ID provided. */
  close(id?: DialogId): DialogId | undefined {
    let targetId: DialogId | undefined;

    if (id !== undefined) {
      targetId = id;
    } else {
      const topDialog = this.dialogs[this.dialogs.length - 1];
      targetId = topDialog?.id;
    }

    if (targetId === undefined) {
      return undefined;
    }

    const dialogIndex = this.dialogs.findIndex((d) => d.id === targetId);
    if (dialogIndex === -1) {
      return undefined;
    }

    const dialog = this.dialogs[dialogIndex];

    // Update dialogs before publishing to keep state in sync
    this.dialogs = [...this.dialogs.slice(0, dialogIndex), ...this.dialogs.slice(dialogIndex + 1)];

    this.publish({ id: targetId, close: true });

    dialog?.onClose?.();

    if (this.dialogs.length === 0) {
      this.restoreFocus();
    }

    return targetId;
  }

  /**
   * Get all active dialogs (oldest first).
   *
   * Returns a stable reference that only changes when dialogs are
   * added/removed/updated.
   */
  getDialogs(): readonly Dialog[] {
    return this.dialogs;
  }

  /** Get the top-most active dialog. */
  getTopDialog(): Dialog | undefined {
    if (this.dialogs.length === 0) {
      return undefined;
    }
    return this.dialogs[this.dialogs.length - 1];
  }

  /** Check if any dialogs are open. */
  isOpen(): boolean {
    return this.dialogs.length > 0;
  }

  /**
   * Internal helper that handles common async dialog logic:
   * - Promise creation
   * - Safe double-resolve protection
   * - Dialog show/close lifecycle
   * - Fallback value handling for ESC/backdrop dismissal
   */
  private showAsyncDialog<T>(
    createContextAndOptions: (
      safeResolve: (value: T) => void,
      dialogId: DialogId,
    ) => {
      showOptions: DialogShowOptions;
      fallback?: T;
    },
    defaultDismissValue: T,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      let resolved = false;

      // Pre-generate the dialog ID so it can be passed to the context factory
      const dialogId = this.idCounter++;

      // Guard to ensure the promise resolves only once, since onClose always fires (even after explicit close)
      const safeResolve = (value: T) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        this.close(dialogId);
      };

      const { showOptions, fallback } = createContextAndOptions(safeResolve, dialogId);

      this.show({
        ...showOptions,
        id: dialogId,
        onClose: () => {
          showOptions.onClose?.();
          safeResolve(fallback ?? defaultDismissValue);
        },
      });
    });
  }

  /**
   * Show a generic prompt dialog and wait for a response.
   *
   * @template T The type of value the prompt resolves to.
   *
   * Accepts a factory function that receives the prompt context and returns
   * AsyncShowOptions (used by framework adapters).
   */
  prompt<T>(
    showFactory: (ctx: PromptContext<T>) => AsyncShowOptions<T | undefined>,
  ): Promise<T | undefined> {
    return this.showAsyncDialog<T | undefined>((safeResolve, dialogId) => {
      const ctx: PromptContext<T> = {
        resolve: safeResolve,
        dismiss: () => safeResolve(undefined),
        dialogId,
      };

      const result = showFactory(ctx);
      return { showOptions: result, fallback: result.fallback };
    }, undefined);
  }

  /** Destroy the manager and clean up resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.cancelPendingFocusRestore();
    this.savedFocus = null;
    this.subscribers.clear();
    this.dialogs = [];
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
