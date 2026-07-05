/**
 * Padding resolution utilities
 *
 * Provides CSS-like padding shorthand support for terminal UI components.
 */

import type { Padding, PaddingInput } from "./types";

/**
 * Resolve padding values with shorthand support
 *
 * Priority (highest to lowest):
 * 1. Specific side (paddingTop, paddingRight, etc.)
 * 2. Axis (paddingX, paddingY)
 * 3. Uniform (padding)
 * 4. Default values
 *
 * @param style - Style object containing padding properties
 * @param defaults - Default padding values (defaults to 0 for all sides)
 * @returns Resolved padding for each side
 *
 * @example
 * ```ts
 * resolvePadding({ padding: 1 })
 * // => { top: 1, right: 1, bottom: 1, left: 1 }
 *
 * resolvePadding({ paddingX: 2, paddingY: 1 })
 * // => { top: 1, right: 2, bottom: 1, left: 2 }
 *
 * resolvePadding({ padding: 1, paddingLeft: 3 })
 * // => { top: 1, right: 1, bottom: 1, left: 3 }
 *
 * resolvePadding({ paddingTop: 2 }, { top: 0, right: 1, bottom: 0, left: 1 })
 * // => { top: 2, right: 1, bottom: 0, left: 1 }
 * ```
 */
export function resolvePadding(
  style?: PaddingInput,
  defaults: Padding = { top: 0, right: 0, bottom: 0, left: 0 },
): Padding {
  if (!style) {
    return { ...defaults };
  }

  const uniform = style.padding;
  const axisX = style.paddingX;
  const axisY = style.paddingY;

  return {
    top: style.paddingTop ?? axisY ?? uniform ?? defaults.top,
    right: style.paddingRight ?? axisX ?? uniform ?? defaults.right,
    bottom: style.paddingBottom ?? axisY ?? uniform ?? defaults.bottom,
    left: style.paddingLeft ?? axisX ?? uniform ?? defaults.left,
  };
}
