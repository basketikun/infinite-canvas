/** Short unique ids — readable in JSON diffs, unique enough per project. */

let counter = 0

export function newId(prefix: string): string {
  counter = (counter + 1) % 46656
  const time = Date.now().toString(36).slice(-6)
  const rand = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')
  const c = counter.toString(36).padStart(3, '0')
  return `${prefix}_${time}${rand}${c}`
}
