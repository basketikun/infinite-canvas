import { useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, RESEARCH_FLOW_NODE_TYPES, type CanvasNodeTypeId } from "@/types/canvas";

// Tailwind's `dark:text-*` utilities don't win the cascade on <button> elements in this build
// (the base `text-*` utility keeps the color property regardless of specificity/order), so the
// on-accent text color for buttons here is set inline instead of via a `dark:` utility class.
const STONE_50 = "#fafaf9";
const STONE_900 = "#1c1917";

registerBuiltinNodes();

const SHOWCASE_TYPES = RESEARCH_FLOW_NODE_TYPES;

type ShowcaseGroup = "all" | "exploration" | "reasoning" | "synthesis";

const GROUP_TYPES: Record<Exclude<ShowcaseGroup, "all">, CanvasNodeTypeId[]> = {
    exploration: [CanvasNodeType.Seed, CanvasNodeType.Direction, CanvasNodeType.ResearchQuestion],
    reasoning: [CanvasNodeType.Problem, CanvasNodeType.Hypothesis, CanvasNodeType.Approach, CanvasNodeType.Method, CanvasNodeType.Evaluation],
    synthesis: [CanvasNodeType.Idea],
};

const GROUPS: ShowcaseGroup[] = ["all", "exploration", "reasoning", "synthesis"];

export default function IndexPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const isDark = useThemeStore((state) => state.theme === "dark");
    const [draft, setDraft] = useState("");
    const [activeGroup, setActiveGroup] = useState<ShowcaseGroup>("all");
    const ownerUserId = useUserStore((state) => state.user?.id);
    const allProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const projectCount = useMemo(() => allProjects.filter((project) => project.localOwnerUserId === ownerUserId).length, [allProjects, ownerUserId]);
    const visibleTypes = useMemo(() => (activeGroup === "all" ? SHOWCASE_TYPES : SHOWCASE_TYPES.filter((type) => GROUP_TYPES[activeGroup].includes(type))), [activeGroup]);

    const submit = () => {
        const title = draft.trim() || t("canvas.defaultTitle", { count: projectCount + 1 });
        const id = createProject(title);
        navigate(`/canvas/${id}`);
    };

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 pt-16 text-center">
                <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-xs font-bold leading-none text-white">CR</span>
                    <span className="text-3xl font-bold tracking-tight sm:text-4xl">{t("meta.title")}</span>
                </div>
                <p className="mt-3 text-base text-stone-500 dark:text-stone-400">{t("home.heroQuestion")}</p>

                <div className="mt-8 w-full rounded-2xl border border-stone-200 bg-stone-50 p-4 text-left shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                        placeholder={t("home.heroPlaceholder")}
                        rows={3}
                        className="w-full resize-none border-none bg-transparent text-base outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500"
                    />
                    <div className="mt-2 flex items-center justify-end">
                        <button
                            type="button"
                            onClick={submit}
                            aria-label={t("home.openCanvas")}
                            title={t("home.openCanvas")}
                            className="flex size-9 items-center justify-center rounded-full bg-stone-900 transition hover:opacity-90 dark:bg-stone-100"
                            style={{ color: isDark ? STONE_900 : STONE_50 }}
                        >
                            <ArrowUp className="size-4" />
                        </button>
                    </div>
                </div>
            </section>

            <section className="relative mx-auto mb-20 max-w-6xl px-6 pt-4">
                <div className="mb-6 text-center">
                    <h2 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("home.showcaseTitle")}</h2>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">{t("home.showcaseDescription")}</p>
                </div>

                <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
                    {GROUPS.map((group) => (
                        <button
                            key={group}
                            type="button"
                            onClick={() => setActiveGroup(group)}
                            style={activeGroup === group ? { color: isDark ? STONE_900 : STONE_50 } : undefined}
                            className={cn(
                                "rounded-full border px-3.5 py-1.5 text-sm transition",
                                activeGroup === group
                                    ? "border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100"
                                    : "border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-900",
                            )}
                        >
                            {t(`home.groups.${group}`)}
                        </button>
                    ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleTypes.map((type) => {
                        const definition = getNodeDefinition(type);
                        if (!definition) return null;
                        return (
                            <div key={type} className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900">
                                <div
                                    className="flex h-20 items-center justify-center"
                                    style={{ background: `linear-gradient(135deg, ${definition.minimapColor}2e 0%, ${definition.minimapColor}0a 100%)` }}
                                >
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${definition.minimapColor}22`, color: definition.minimapColor }}>
                                        {definition.icon}
                                    </div>
                                </div>
                                <div className="p-5 pt-4">
                                    <h3 className="text-sm font-medium">{definition.title}</h3>
                                    <p className="mt-1.5 text-sm leading-6 text-stone-500 dark:text-stone-400">{t(`home.nodeTypes.${type}`)}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </main>
    );
}
