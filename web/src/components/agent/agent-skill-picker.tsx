import { useMemo, useState } from "react";
import { Button, Input, Popover, Tooltip } from "antd";
import { Check, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function AgentSkillPicker() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const connected = useAgentStore((state) => state.connected);
    const url = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const skills = useAgentSkillStore((state) => state.skills);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const loading = useAgentSkillStore((state) => state.loading);
    const loadSkills = useAgentSkillStore((state) => state.loadSkills);
    const selectSkill = useAgentSkillStore((state) => state.selectSkill);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const endpoint = url.trim().replace(/\/$/, "");
    const enabledSkills = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return skills.filter((skill) => skill.enabled && (!keyword || [skill.name, skill.description, skill.interface?.displayName, skill.interface?.shortDescription, skill.shortDescription].some((value) => value?.toLowerCase().includes(keyword))));
    }, [query, skills]);
    const content = (
        <div className="w-72" style={{ color: theme.node.text }}>
            <div className="mb-2 px-1 text-xs font-medium" style={{ color: theme.node.muted }}>{t("agent.skills.selectLocal")}</div>
            <Input allowClear size="small" value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search className="size-3.5" />} placeholder={t("agent.skills.search")} />
            <div className="thin-scrollbar mt-2 max-h-64 overflow-y-auto">
                {enabledSkills.length ? enabledSkills.map((skill) => {
                    const selected = selectedSkill?.name === skill.name && selectedSkill.path === skill.path;
                    return (
                        <button
                            key={`${skill.name}:${skill.path}`}
                            type="button"
                            className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => {
                                selectSkill(skill);
                                setOpen(false);
                            }}
                        >
                            <Sparkles className="mt-0.5 size-4 shrink-0" style={{ color: selected ? theme.node.text : theme.node.muted }} />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{skill.interface?.displayName || skill.name}</span>
                                <span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>{skill.interface?.shortDescription || skill.shortDescription || skill.description}</span>
                            </span>
                            {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
                        </button>
                    );
                }) : (
                    <div className="px-2 py-6 text-center text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(loading ? "agent.skills.loading" : skills.length ? "agent.skills.noMatch" : "agent.skills.none")}
                    </div>
                )}
            </div>
        </div>
    );
    return (
        <Tooltip title={t(connected ? "agent.skills.select" : "agent.skills.connectHint")} placement="top" open={open ? false : undefined}>
            <Popover
                arrow={false}
                trigger="click"
                placement="topLeft"
                open={open}
                onOpenChange={(nextOpen) => {
                    setOpen(nextOpen);
                    if (nextOpen && connected && !skills.length && !loading) void loadSkills(endpoint, token);
                }}
                content={content}
            >
                <Button
                    type="text"
                    shape="circle"
                    className="!h-9 !w-9 !min-w-9"
                    disabled={!connected}
                    style={{ color: selectedSkill ? theme.node.text : theme.node.muted, background: selectedSkill ? theme.toolbar.activeBg : undefined }}
                    icon={<Sparkles className="size-4" />}
                    aria-label={t("agent.skills.select")}
                />
            </Popover>
        </Tooltip>
    );
}
