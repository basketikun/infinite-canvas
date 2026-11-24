import type { WorkspaceConfig, WorkspaceConfigMutation } from "@infinite-canvas/shared/workspace-config";

export interface WorkspaceConfigAdapter {
    /**
     * 读取当前工作区配置；首次使用返回 null。
     */
    load(): Promise<WorkspaceConfig | null>;
    /**
     * 保存完整配置；失败时拒绝，不切换存储。
     */
    save(config: WorkspaceConfig): Promise<void>;
    /** 按实际传输身份合并保存；确认的连接已被替换时返回 false。 */
    update(change: WorkspaceConfigMutation): Promise<boolean>;
}

export let workspaceConfig: WorkspaceConfigAdapter;

export function initializeWorkspaceConfig(adapter: WorkspaceConfigAdapter) {
    if (workspaceConfig) throw new Error("WORKSPACE_CONFIG_ALREADY_INITIALIZED");
    workspaceConfig = adapter;
}
