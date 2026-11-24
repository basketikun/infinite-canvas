import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";

export function ListEmpty({ className, text }: { className: string; text: string }) {
    return <div role="status" className={cn("workbench-list-empty mx-2 my-8 text-center text-sm leading-[22px]", className)}>
        <svg aria-hidden viewBox="0 0 64 40" className="mx-auto mb-2 h-10 w-16">
            <ellipse cx="32" cy="34" rx="32" ry="6" fill="var(--empty-shadow)" />
            <g stroke="var(--empty-stroke)">
                <path d="M9 14 19.5 2a3 3 0 0 1 2-1h21a3 3 0 0 1 2 1L55 14v10H9z" fill="none" />
                <path d="M9 14h11c1.5 0 2 1.2 2.5 3s1.3 3 3 3h13c1.7 0 2.5-1.2 3-3s1-3 2.5-3h11v18a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z" fill="var(--empty-face)" />
            </g>
        </svg>
        <p>{text}</p>
    </div>;
}
