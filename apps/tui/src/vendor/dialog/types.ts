import type { BorderStyle, Renderable, RenderContext } from "@opentui/core";
import { JSX_CONTENT_KEY } from "./constants";

export type DialogId = string | number;

export type DialogSize = "small" | "medium" | "large" | "full";

export interface DialogStyle {
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: BorderStyle;
  border?: boolean;
  width?: number | string;
  maxWidth?: number;
  minWidth?: number;
  maxHeight?: number;
  padding?: number;
}

/** Factory function that creates dialog content from a RenderContext. */
export type DialogContentFactory = (ctx: RenderContext) => Renderable;

export interface Dialog {
  id: DialogId;
  content: DialogContentFactory;
  size?: DialogSize;
  style?: DialogStyle;
  unstyled?: boolean;
  /** @default true */
  closeOnEscape?: boolean;
  /** @default false */
  closeOnClickOutside?: boolean;
  /** Per-dialog backdrop color override. */
  backdropColor?: string;
  onClose?: () => void;
  onOpen?: () => void;
  onBackdropClick?: () => void;
}

/**
 * Internal dialog type with adapter-specific properties.
 * Used by React for deferred visibility.
 * @internal
 */
export interface InternalDialog extends Dialog {
  /** @internal Used by React/Solid bindings to store JSX portal content. */
  [JSX_CONTENT_KEY]?: unknown;
  /**
   * When true, the dialog is initially hidden until visibility is updated.
   * Used by adapter(s) to prevent flicker when JSX content is
   * injected via portals after the dialog renderable is created.
   */
  deferred?: boolean;
}

export interface DialogToClose {
  id: DialogId;
  close: true;
}

export interface DialogShowOptions extends Omit<Dialog, "id"> {
  id?: DialogId;
}

export interface InternalDialogShowOptions extends Omit<InternalDialog, "id"> {
  id?: DialogId;
}

export interface DialogOptions {
  style?: DialogStyle;
}

export interface DialogContainerOptions {
  /** @default "medium" */
  size?: DialogSize;
  dialogOptions?: DialogOptions;
  sizePresets?: Partial<Record<DialogSize, number>>;
  /** @default true */
  closeOnEscape?: boolean;
  /** @default false */
  closeOnClickOutside?: boolean;
  /** @default "#000000" */
  backdropColor?: string;
  unstyled?: boolean;
}

// =============================================================================
// Async Dialog Base Types
// =============================================================================
// Generic types shared between the core manager and framework adapters.

/**
 * Base options for async dialog methods (prompt).
 * Excludes `content` (replaced by context-specific content) and `id` (auto-generated).
 * Note: `onClose` is supported - it will be called before the Promise resolves.
 */
export interface AsyncDialogOptions extends Omit<DialogShowOptions, "content" | "id"> {}

/**
 * Generic base for prompt dialog options.
 * @template T The type of value the prompt resolves to.
 * @template TContent The content type (varies by adapter).
 */
export interface BasePromptOptions<T, TContent> extends AsyncDialogOptions {
  /** Content factory that receives the prompt context. */
  content: TContent;
  /** Fallback value when dialog is dismissed via ESC or backdrop click. */
  fallback?: T;
}

/**
 * Base interface for dialog actions returned by useDialog() hooks.
 * Framework adapters extend this and add the generic prompt method.
 * @template TShowOptions Options for the show method.
 */
export interface BaseDialogActions<TShowOptions> {
  /** Show a new dialog and return its ID. */
  show: (options: TShowOptions) => DialogId;
  /** Close a specific dialog by ID, or the top-most dialog if no ID provided. */
  close: (id?: DialogId) => DialogId | undefined;
}

export function isDialogToClose(value: Dialog | DialogToClose): value is DialogToClose {
  return "close" in value && value.close === true;
}
