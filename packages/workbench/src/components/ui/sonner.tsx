import type { CSSProperties } from "react";
import { Check, CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, X } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useThemeStore } from "@workbench/stores/use-theme-store";

export const workbenchMessageOptions = {
    info: { className: "workbench-message generation-workspace-controls", icon: <span aria-hidden>i</span> },
    success: { className: "workbench-message", icon: <Check size={11} strokeWidth={2.5} aria-hidden /> },
    error: { className: "workbench-message", icon: <X size={11} strokeWidth={2.5} aria-hidden /> },
    warning: { className: "workbench-message", icon: <span aria-hidden>!</span> },
};

export function Toaster({ ...props }: ToasterProps) {
    const theme = useThemeStore((state) => state.theme);

    return (
        <Sonner
            theme={theme}
            className="toaster group"
            position="top-center"
            duration={3000}
            containerAriaLabel="操作提示"
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <OctagonXIcon className="size-4" />,
                loading: <Loader2Icon className="size-4 animate-spin" />,
            }}
            style={{
                "--normal-bg": "var(--popover)",
                "--normal-text": "var(--popover-foreground)",
                "--normal-border": "var(--border)",
                "--border-radius": "var(--radius)",
            } as CSSProperties}
            toastOptions={{ classNames: { toast: "cn-toast" } }}
            {...props}
        />
    );
}
