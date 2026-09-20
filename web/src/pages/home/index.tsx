import { useMemo, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { RESEARCH_FLOW_NODE_TYPES } from "@/types/canvas";

registerBuiltinNodes();

const SHOWCASE_TYPES = RESEARCH_FLOW_NODE_TYPES;

export default function IndexPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [draft, setDraft] = useState("");
    const ownerUserId = useUserStore((state) => state.user?.id);
    const allProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const projectCount = useMemo(() => allProjects.filter((project) => project.localOwnerUserId === ownerUserId).length, [allProjects, ownerUserId]);

    const submit = () => {
        const title = draft.trim() || t("canvas.defaultTitle", { count: projectCount + 1 });
        const id = createProject(title);
        navigate(`/canvas/${id}`);
    };

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 pt-16 text-center">
                <h1 className="text-3xl font-semibold sm:text-4xl">{t("home.heroQuestion")}</h1>

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
                            className="flex size-9 items-center justify-center rounded-full bg-stone-900 text-white transition hover:opacity-90 dark:bg-stone-100 dark:text-stone-900"
                        >
                            <ArrowUp className="size-4" />
                        </button>
                    </div>
                </div>
            </section>

            <section className="relative mx-auto mb-20 max-w-6xl px-6 pt-4">
                <div className="mb-8 text-center">
                    <h2 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("home.showcaseTitle")}</h2>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">{t("home.showcaseDescription")}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {SHOWCASE_TYPES.map((type) => {
                        const definition = getNodeDefinition(type);
                        if (!definition) return null;
                        return (
                            <div key={type} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${definition.minimapColor}1f`, color: definition.minimapColor }}>
                                    {definition.icon}
                                </div>
                                <div>
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
