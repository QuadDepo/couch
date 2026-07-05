/**
 * Style merging utilities
 *
 * Provides helpers for combining style objects with proper precedence.
 */

/**
 * Merge multiple style objects (later wins)
 *
 * Uses shallow Object.assign, so later styles completely
 * override earlier values for the same property.
 *
 * @param styles - Style objects to merge (undefined values are skipped)
 * @returns Merged style object
 *
 * @example
 * ```ts
 * mergeStyles(
 *   { borderColor: "red", padding: 1 },
 *   { borderColor: "blue" }
 * )
 * // => { borderColor: "blue", padding: 1 }
 *
 * mergeStyles(
 *   { padding: 1 },
 *   undefined,
 *   { paddingLeft: 2 }
 * )
 * // => { padding: 1, paddingLeft: 2 }
 * ```
 */
export function mergeStyles<T extends object>(...styles: (Partial<T> | undefined)[]): T {
  const result = {} as T;

  for (const style of styles) {
    if (!style) continue;
    Object.assign(result, style);
  }

  return result;
}
