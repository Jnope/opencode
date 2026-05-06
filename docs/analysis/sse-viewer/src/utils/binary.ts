/**
 * Binary search utility — ported from packages/core/src/util/binary.ts
 * Used for maintaining sorted arrays by ID.
 */

export interface BinarySearchResult {
  found: boolean
  index: number
}

export function binarySearch<T>(
  array: T[],
  id: string,
  compare: (item: T) => string,
): BinarySearchResult {
  let left = 0
  let right = array.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const midId = compare(array[mid])

    if (midId === id) {
      return { found: true, index: mid }
    } else if (midId < id) {
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return { found: false, index: left }
}

/** Compare two strings for sorting */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
