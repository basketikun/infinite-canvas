import { useId } from "react";

export function ChannelSegments<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Record<NoInfer<T>, string>; value: T; onChange: (next: T) => void }) {
    const name = useId();
    return <div role="radiogroup" aria-label={label} className="flex rounded bg-(--channel-segment) p-0.5 text-(--channel-secondary)">
        {options.map((option) => <label key={option} className="relative cursor-pointer">
            <input type="radio" name={name} className="peer sr-only" value={option} checked={value === option} onChange={() => onChange(option)} />
            <span className="block rounded-sm px-[7px] leading-5 peer-checked:bg-(--workbench-elevated-panel) peer-checked:text-(--workbench-elevated-text) peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-(--workbench-button-focus)">{labels[option]}</span>
        </label>)}
    </div>;
}
