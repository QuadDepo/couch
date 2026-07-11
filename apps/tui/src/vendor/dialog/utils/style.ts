import { DEFAULT_SIZE, DEFAULT_SIZES, FULL_SIZE_OFFSET } from "../constants";
import { DEFAULT_STYLE } from "../themes";
import type { Dialog, DialogContainerOptions, DialogSize, DialogStyle } from "../types";
import { mergeStyles } from "./styles";

export interface ComputeDialogStyleInput {
  dialog: Dialog;
  containerOptions?: DialogContainerOptions;
}

export interface ComputedDialogStyle extends DialogStyle {
  resolvedPadding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export function computeDialogStyle(input: ComputeDialogStyleInput): ComputedDialogStyle {
  const { dialog, containerOptions } = input;

  const isUnstyled = dialog.unstyled ?? containerOptions?.unstyled ?? false;

  const baseStyle = isUnstyled ? {} : DEFAULT_STYLE;

  const computed = mergeStyles<DialogStyle>(
    baseStyle,
    containerOptions?.dialogOptions?.style,
    dialog.style,
  );

  const uniformPadding = isUnstyled ? 0 : (computed.padding ?? 0);
  const resolvedPadding = {
    top: uniformPadding,
    right: uniformPadding,
    bottom: uniformPadding,
    left: uniformPadding,
  };

  return {
    ...computed,
    resolvedPadding,
  };
}

export function getDialogWidth(
  size: DialogSize | undefined,
  containerOptions?: DialogContainerOptions,
  terminalWidth?: number,
): number {
  const effectiveSize: DialogSize = size ?? containerOptions?.size ?? DEFAULT_SIZE;

  const customWidth = containerOptions?.sizePresets?.[effectiveSize];
  if (customWidth !== undefined && customWidth > 0) {
    return customWidth;
  }

  const defaultWidth = DEFAULT_SIZES[effectiveSize];

  if (defaultWidth === -1) {
    return terminalWidth ? terminalWidth - FULL_SIZE_OFFSET : 80;
  }

  return defaultWidth;
}
