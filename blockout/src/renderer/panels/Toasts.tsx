/**
 * Transient notifications. Toasts auto-dismiss (store handles the timer);
 * clicking one dismisses it early.
 */

import { useStore } from '../store'

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => dismissToast(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
