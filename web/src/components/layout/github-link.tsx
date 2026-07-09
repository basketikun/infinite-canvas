import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    return (
        <span
            className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", className)}
            style={style}
            role="link"
            aria-disabled="true"
            aria-label="Cozy Tv"
            title="Cozy Tv"
        >
            <img src="/logo.png" alt="" className="size-5 rounded-sm object-contain" />
        </span>
    );
}
