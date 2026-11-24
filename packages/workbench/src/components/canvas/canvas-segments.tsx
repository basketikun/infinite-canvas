import { useId, type ReactNode } from "react";

export function CanvasSegments<T extends string | number>({ label, value, options, onChange, block = false, compact = false }: { label: string; value: T; options: readonly { value: T; label: ReactNode; disabled?: boolean }[]; onChange: (next: T) => void; block?: boolean; compact?: boolean }) {
    const name = useId();
    return <div role="radiogroup" aria-label={label} className={`${block ? "flex w-full" : "inline-flex"} rounded-md bg-muted p-0.5`}>
        {options.map(option => <label key={option.value} className={`relative min-w-0 ${block ? "flex-1" : ""} ${option.disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input type="radio" name={name} className="peer sr-only" checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
            <span className={`flex items-center justify-center rounded peer-checked:bg-(--workbench-elevated-panel) peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-(--workbench-button-focus) peer-disabled:opacity-40 ${compact ? "min-h-5 px-1.5 text-xs" : "min-h-7 px-2 text-sm"}`}>{option.label}</span>
        </label>)}
    </div>;
}
