import { useRef, useState } from "react";
import { App, Button, Input, Modal, Tooltip } from "antd";
import { Check, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentApiError, type AgentProject } from "@/services/api/canvas-agent";

function folderName(value: string) {
    const normalized = value.trim().replace(/[\\/]+$/, "");
    if (!normalized) return "";
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || normalized;
}

type Props = {
    open: boolean;
    projects: AgentProject[];
    activeProjectId: string;
    busy: boolean;
    onClose: () => void;
    onSelect: (project: AgentProject) => Promise<void>;
    onCreate: (input: { name: string; workspacePath: string }) => Promise<void>;
    onDelete: (project: AgentProject) => Promise<void>;
    onChooseDirectory: (signal?: AbortSignal) => Promise<string>;
};

export function AgentProjectModal({ open, projects, activeProjectId, busy, onClose, onSelect, onCreate, onDelete, onChooseDirectory }: Props) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [workspacePath, setWorkspacePath] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const directoryRequestRef = useRef<AbortController | null>(null);
    const generatedNameRef = useRef("");
    const nameEditedRef = useRef(false);

    const close = () => {
        if (submitting) return;
        directoryRequestRef.current?.abort();
        setCreating(false);
        onClose();
    };
    const create = async () => {
        const projectName = name.trim() || folderName(workspacePath);
        if (!workspacePath.trim() || !projectName) return message.error(t("agent.projects.required"));
        setSubmitting(true);
        try {
            await onCreate({ name: projectName, workspacePath: workspacePath.trim() });
            setName("");
            setWorkspacePath("");
            generatedNameRef.current = "";
            nameEditedRef.current = false;
            setCreating(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.projects.createFailed"));
        } finally {
            setSubmitting(false);
        }
    };
    const remove = (project: AgentProject) => {
        modal.confirm({
            title: t("agent.projects.deleteTitle", { name: project.name }),
            content: t("agent.projects.deleteDescription"),
            okText: t("agent.projects.delete"),
            okType: "danger",
            cancelText: t("common.cancel"),
            onOk: async () => {
                setSubmitting(true);
                try {
                    await onDelete(project);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("agent.projects.deleteFailed"));
                    throw error;
                } finally {
                    setSubmitting(false);
                }
            },
        });
    };
    const chooseDirectory = async () => {
        const controller = new AbortController();
        directoryRequestRef.current = controller;
        try {
            const selected = await onChooseDirectory(controller.signal);
            if (selected) {
                const generatedName = folderName(selected);
                setWorkspacePath(selected);
                if (!nameEditedRef.current || !name.trim()) setName(generatedName);
                generatedNameRef.current = generatedName;
            }
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof AgentApiError && error.status === 404 ? t("agent.projects.directoryUnavailable") : error instanceof Error ? error.message : t("agent.projects.directoryFailed"));
        } finally {
            if (directoryRequestRef.current === controller) directoryRequestRef.current = null;
        }
    };

    return (
        <>
            <Modal title={t("agent.projects.title")} open={open} footer={null} width={620} destroyOnHidden onCancel={close}>
            <div className="mt-4 space-y-2">
                {projects.map((project) => {
                    const active = project.id === activeProjectId;
                    return (
                        <div key={project.id} className={`flex items-center gap-3 rounded-md border p-3 ${active ? "bg-black/[0.035] dark:bg-white/[0.06]" : ""}`}>
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" disabled={busy || submitting || active} onClick={() => void onSelect(project)}>
                                <FolderOpen className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{project.name}</span>{project.isDefault ? <span className="text-xs font-normal opacity-60">{t("agent.projects.default")}</span> : null}</span>
                                    <span className="mt-1 block truncate font-mono text-[11px] opacity-60">{project.workspacePath}</span>
                                </span>
                                {active ? <Check className="size-4 shrink-0 text-green-600" /> : null}
                            </button>
                            {!project.isDefault ? (
                                <Tooltip title={t("agent.projects.delete")}>
                                    <Button type="text" danger shape="circle" size="small" aria-label={t("agent.projects.delete")} disabled={busy || submitting} icon={<Trash2 className="size-3.5" />} onClick={() => remove(project)} />
                                </Tooltip>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            {creating ? (
                <div className="mt-5 space-y-3 border-t pt-4">
                    <div className="text-sm font-medium">{t("agent.projects.createTitle")}</div>
                    <div className="text-xs leading-5 opacity-65">{t("agent.projects.createHint")}</div>
                    <Input value={name} maxLength={80} disabled={busy || submitting} placeholder={t("agent.projects.namePlaceholder")} onChange={(event) => { nameEditedRef.current = event.target.value !== generatedNameRef.current; setName(event.target.value); }} />
                    <div className="flex gap-2">
                        <Input className="min-w-0 flex-1" value={workspacePath} disabled={busy || submitting} placeholder={t("agent.projects.pathPlaceholder")} onChange={(event) => setWorkspacePath(event.target.value)} />
                        <Button className="shrink-0" disabled={busy || submitting} icon={<FolderOpen className="size-4" />} onClick={() => void chooseDirectory()}>{t("agent.projects.chooseDirectory")}</Button>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="text" disabled={submitting} onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
                        <Button type="primary" loading={submitting} disabled={busy} onClick={() => void create()}>{t("agent.projects.create")}</Button>
                    </div>
                </div>
            ) : (
                <Button type="text" className="!mt-4 !px-1" disabled={busy || submitting} icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t("agent.projects.newLocal")}</Button>
            )}
            </Modal>
        </>
    );
}
