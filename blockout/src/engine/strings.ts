// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Name sanitization for file paths and glTF node names. Unicode-aware —
 * a shot named "追跡" keeps its characters — and never returns an empty
 * string (which would collide export paths and animation targets).
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const MAX_COMPONENT_LENGTH = 120

function deterministicHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Produce a portable filename/path component. In addition to the punctuation
 * cleanup used by glTF names, this handles Windows device names, trailing
 * dots/spaces, and overlong components while retaining readable Unicode.
 */
export function sanitizeName(name: string): string {
  let cleaned = name
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[. -]+$/g, '')
  const hash = deterministicHash(name)
  if (!cleaned) cleaned = `untitled-${hash}`
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`
  if (cleaned.length > MAX_COMPONENT_LENGTH) {
    cleaned = `${cleaned.slice(0, MAX_COMPONENT_LENGTH - hash.length - 1)}-${hash}`
  }
  return cleaned
}

/** Make a name unique within a set (appends -2, -3, …), updating the set. */
export function uniqueName(base: string, used: Set<string>): string {
  let candidate = base
  let n = 2
  while (used.has(candidate)) {
    candidate = `${base}-${n}`
    n++
  }
  used.add(candidate)
  return candidate
}
