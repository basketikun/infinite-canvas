/** Convert a project-local path to the slash-separated on-disk schema form. */
export function normalizeProjectRelativePath(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) return null

  const path = input.replace(/\\/g, '/')
  // Reject POSIX roots, UNC/device roots, and Windows drive-qualified paths.
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('//')) return null

  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

/** FFmpeg concat files are most portable with slash-separated absolute paths. */
export function ffmpegConcatEntry(input: string): string {
  const normalized = input.replace(/\\/g, '/')
  const escaped = normalized.replace(/'/g, "'\\''")
  return `file '${escaped}'`
}
