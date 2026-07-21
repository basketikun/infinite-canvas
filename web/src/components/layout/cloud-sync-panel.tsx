import { App, Button } from "antd";
import { Download, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCloudProject, listCloudProjects, type CloudProjectSummary } from "@/services/cloud-sync/client";
import { createCloudConflictCopy, restoreCloudProject, syncCloudProject, type CloudSyncConflict } from "@/services/cloud-sync/sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";

export function CloudSyncPanel({ token, userID, baseUrl }: { token: string; userID: string; baseUrl: string }) {
    const { message } = App.useApp();
    const projects = useCanvasStore((state) => state.projects);
    const replaceProjects = useCanvasStore((state) => state.replaceProjects);
    const revisions = useConfigStore((state) => state.cloudRevisions);
    const setCloudRevision = useConfigStore((state) => state.setCloudRevision);
    const [remoteProjects, setRemoteProjects] = useState<CloudProjectSummary[]>([]);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [conflicts, setConflicts] = useState<CloudSyncConflict[]>([]);
    const ready = Boolean(token.trim() && baseUrl.trim());
    const revisionKey = (projectID: string) => `${userID}:${projectID}`;

    const refreshRemote = async () => {
        if (!ready) return;
        setLoadingRemote(true);
        try {
            setRemoteProjects(await listCloudProjects(token, baseUrl));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取云端画布列表失败");
        } finally {
            setLoadingRemote(false);
        }
    };

    useEffect(() => {
        void refreshRemote();
        // token/baseUrl 变更后需重新读取当前账号的项目列表。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, baseUrl]);

    const replaceLocalProject = (project: (typeof projects)[number]) => {
        const current = useCanvasStore.getState().projects;
        replaceProjects([project, ...current.filter((item) => item.id !== project.id)]);
    };

    const syncOne = async (project: (typeof projects)[number], revision = revisions[revisionKey(project.id)] || 0) => {
        const result = await syncCloudProject(project, { revision }, token, baseUrl);
        if ("currentRevision" in result) {
            setConflicts((current) => [...current.filter((item) => item.project.id !== project.id), result]);
            return false;
        }
        setCloudRevision(revisionKey(project.id), result.revision);
        setConflicts((current) => current.filter((item) => item.project.id !== project.id));
        return true;
    };

    const syncAll = async () => {
        if (!ready) return;
        setSyncing(true);
        let saved = 0;
        try {
            for (const project of useCanvasStore.getState().projects) {
                if (await syncOne(project)) saved += 1;
            }
            await refreshRemote();
            message.success(`已同步 ${saved} 个本地画布${conflicts.length ? "；冲突项目请手动处理" : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "云同步失败");
        } finally {
            setSyncing(false);
        }
    };

    const useRemote = async (id: string) => {
        setSyncing(true);
        try {
            const remote = await fetchCloudProject(id, token, baseUrl);
            const restored = await restoreCloudProject(remote, token, baseUrl);
            replaceLocalProject(restored.project);
            setCloudRevision(revisionKey(restored.project.id), restored.revision);
            setConflicts((current) => current.filter((item) => item.project.id !== id));
            message.success(`已恢复云端画布「${restored.project.title}」`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "恢复云端画布失败");
        } finally {
            setSyncing(false);
        }
    };

    const overwriteRemote = async (conflict: CloudSyncConflict) => {
        setSyncing(true);
        try {
            if (await syncOne(conflict.project, conflict.currentRevision)) {
                await refreshRemote();
                message.success("已用本地版本覆盖云端版本");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "覆盖云端版本失败");
        } finally {
            setSyncing(false);
        }
    };

    const keepConflictCopy = (conflict: CloudSyncConflict) => {
        const copy = createCloudConflictCopy(conflict.project);
        replaceProjects([copy, ...useCanvasStore.getState().projects]);
        message.success("已另存为本地冲突副本；原画布仍等待你选择本地或远端版本");
    };

    if (!ready) return <div className="rounded-lg border border-stone-200 px-4 py-3 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-300">请先切换为服务端模式并登录控制平面，且为画布配置公开的控制平面地址。</div>;

    return (
        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold">控制平面云同步</div>
                    <div className="mt-1 text-xs text-stone-500">仅同步画布和其引用的本地媒体。WebDAV 的资产与生成记录同步保持独立。</div>
                </div>
                <div className="text-xs text-stone-500">
                    本地 {projects.length} 个 / 云端 {remoteProjects.length} 个
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button icon={<RefreshCw className="size-4" />} loading={loadingRemote} disabled={syncing} onClick={() => void refreshRemote()}>
                    刷新云端列表
                </Button>
                <Button type="primary" icon={<Upload className="size-4" />} loading={syncing} onClick={() => void syncAll()}>
                    同步全部本地画布
                </Button>
            </div>
            {remoteProjects.length ? (
                <div className="mt-4 divide-y divide-stone-100 rounded border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                    {remoteProjects.map((project) => (
                        <div key={project.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0">
                                <div className="truncate font-medium">{project.title || "未命名画布"}</div>
                                <div className="text-xs text-stone-500">revision {project.currentRevision}</div>
                            </div>
                            <Button size="small" icon={<Download className="size-3.5" />} disabled={syncing} onClick={() => void useRemote(project.id)}>
                                使用远端
                            </Button>
                        </div>
                    ))}
                </div>
            ) : null}
            {conflicts.length ? (
                <div className="mt-4 space-y-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    {conflicts.map((conflict) => (
                        <div key={conflict.project.id}>
                            <div className="font-medium">
                                「{conflict.project.title}」在其他设备已有更新（远端 revision {conflict.currentRevision}）
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button size="small" disabled={syncing} onClick={() => void overwriteRemote(conflict)}>
                                    用本地覆盖远端
                                </Button>
                                <Button size="small" disabled={syncing} onClick={() => void useRemote(conflict.project.id)}>
                                    使用远端
                                </Button>
                                <Button size="small" disabled={syncing} onClick={() => keepConflictCopy(conflict)}>
                                    另存本地副本
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
