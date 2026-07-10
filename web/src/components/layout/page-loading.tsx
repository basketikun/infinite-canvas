import { useTranslation } from "@/components/layout/locale-provider";

export function PageLoading({ label }: { label?: string }) {
    const { t } = useTranslation();

    return (
        <main className="flex h-full min-h-[240px] items-center justify-center bg-background text-sm text-stone-500 dark:text-stone-400">
            {label ?? t("pageLoading.label")}
        </main>
    );
}
