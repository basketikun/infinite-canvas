import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = process.env.CANVAS_AGENT_CONFIG_DIR || path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const DEFAULT_PROJECT_ID = "default";
export const VERSION = readPackageVersion();
export const CLARIFICATION_TIMEOUT_MS = Math.max(60_000, Number(process.env.CANVAS_AGENT_CLARIFICATION_TIMEOUT_MS) || 30 * 60 * 1000);
export const CLARIFICATION_TOOL_TIMEOUT_SEC = Math.ceil(CLARIFICATION_TIMEOUT_MS / 1000) + 30;
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type AgentProjectConfig = SiteWorkspaceConfig & { id: string; name: string };
export type CanvasAgentConfig = {
    url: string;
    token: string;
    origins?: string[];
    projects?: AgentProjectConfig[];
    // 旧版配置仅用于一次性迁移，迁移后不再写入。
    workspace?: SiteWorkspaceConfig;
};

export type AgentProjectInput = { name: string; workspacePath: string };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
export function saveConfig(config: CanvasAgentConfig) {
    writeConfigFile(CONFIG_DIR, CONFIG_FILE, config);
}

/** 写入配置并强制目录 0700、文件 0600，包括纠正已有宽松权限。 */
export function writeConfigFile(dir: string, file: string, config: CanvasAgentConfig) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(file, 0o600);
}

/** 确保项目注册表存在，并将旧单工作区配置一次性迁入默认项目。 */
export function ensureProjects(config: CanvasAgentConfig) {
    const existing = config.projects?.find((project) => project.id === DEFAULT_PROJECT_ID);
    if (existing) {
        const projects = config.projects!.map((project) => project.id === DEFAULT_PROJECT_ID ? normalizeStoredProject(project) : project);
        if (JSON.stringify(projects) !== JSON.stringify(config.projects)) {
            config.projects = projects;
            saveConfig(config);
        }
        return projects;
    }

    const legacy = config.workspace;
    const defaultProject: AgentProjectConfig = {
        id: DEFAULT_PROJECT_ID,
        name: "默认工作区",
        workspacePath: legacy?.workspacePath ? resolveWorkspacePath(legacy.workspacePath) : path.join(CONFIG_DIR, "codex-workspaces", "site"),
        activeThreadId: legacy?.activeThreadId,
        pinnedThreadIds: legacy?.pinnedThreadIds,
    };
    initializeWorkspace(defaultProject.workspacePath, true);
    config.projects = [defaultProject, ...(config.projects || []).map(normalizeStoredProject)];
    delete config.workspace;
    saveConfig(config);
    return config.projects;
}

/** 返回当前项目注册表，默认项目始终存在。 */
export function listProjects(config: CanvasAgentConfig) {
    return ensureProjects(config);
}

/** 按项目 ID 获取项目，不存在时抛出明确错误。 */
export function getProject(config: CanvasAgentConfig, projectId?: string) {
    const project = ensureProjects(config).find((item) => item.id === (projectId || DEFAULT_PROJECT_ID));
    if (!project) throw new Error("项目不存在或已被移除。");
    assertExistingDirectory(project.workspacePath);
    initializeWorkspace(project.workspacePath, project.id === DEFAULT_PROJECT_ID);
    return project;
}

/** 创建一个绑定现有本机目录的 Canvas Agent 项目。 */
export function createProject(config: CanvasAgentConfig, input: AgentProjectInput) {
    const workspacePath = resolveExistingDirectory(input.workspacePath);
    const name = input.name.trim() || folderName(workspacePath);
    if (!name) throw new Error("无法从项目目录确定项目名称。");
    const projects = ensureProjects(config);
    if (projects.some((project) => sameWorkspacePath(canonicalWorkspacePath(project.workspacePath), workspacePath))) throw new Error("该目录已关联为 Canvas Agent 项目。");
    const project: AgentProjectConfig = { id: crypto.randomUUID(), name, workspacePath };
    initializeWorkspace(workspacePath, false);
    config.projects = [...projects, project];
    saveConfig(config);
    return project;
}

function folderName(workspacePath: string) {
    const normalized = workspacePath.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || normalized;
}

/** 更新一个项目的会话元数据。 */
export function updateProject(config: CanvasAgentConfig, projectId: string, patch: Partial<Pick<AgentProjectConfig, "activeThreadId" | "pinnedThreadIds">>) {
    const projects = ensureProjects(config);
    const index = projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new Error("项目不存在或已被移除。");
    const project = { ...projects[index], ...patch };
    projects[index] = project;
    config.projects = projects;
    saveConfig(config);
    return project;
}

/** 删除 Canvas Agent 项目关联，不会删除本机目录或其中任何文件。 */
export function removeProject(config: CanvasAgentConfig, projectId: string) {
    if (projectId === DEFAULT_PROJECT_ID) throw new Error("默认工作区不可删除。");
    const projects = ensureProjects(config);
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在或已被移除。");
    config.projects = projects.filter((item) => item.id !== projectId);
    saveConfig(config);
    return project;
}

/** 兼容旧调用：默认工作区仍保持原有入口。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    return getProject(config, DEFAULT_PROJECT_ID);
}

/** 兼容旧调用：只更新默认工作区。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    return updateProject(config, DEFAULT_PROJECT_ID, patch);
}

/** 创建默认目录或为新项目补充 Canvas Agent 管理的 AGENTS.md。 */
function initializeWorkspace(workspacePath: string, createDirectory: boolean) {
    if (initializedWorkspaces.has(workspacePath)) return;
    if (createDirectory) fs.mkdirSync(workspacePath, { recursive: true });
    assertExistingDirectory(workspacePath);
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    initializedWorkspaces.add(workspacePath);
}

function normalizeStoredProject(project: AgentProjectConfig): AgentProjectConfig {
    const workspacePath = project.id === DEFAULT_PROJECT_ID ? resolveWorkspacePath(project.workspacePath) : resolveExistingDirectory(project.workspacePath);
    initializeWorkspace(workspacePath, project.id === DEFAULT_PROJECT_ID);
    return { ...project, workspacePath };
}

/** 用户新建项目必须输入一个真实存在的绝对目录。 */
function resolveExistingDirectory(value: string) {
    const input = value.trim();
    if (!input || !path.isAbsolute(input)) throw new Error("项目目录必须是存在的绝对目录。");
    let workspacePath: string;
    try {
        workspacePath = fs.realpathSync.native(input);
    } catch {
        throw new Error("项目目录不存在或无法访问。");
    }
    assertExistingDirectory(workspacePath);
    return workspacePath;
}

function assertExistingDirectory(workspacePath: string) {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(workspacePath);
    } catch {
        throw new Error("项目目录不存在或无法访问。");
    }
    if (!stat.isDirectory()) throw new Error("项目目录必须是文件夹，不能是文件。");
}

function sameWorkspacePath(left: string, right: string) {
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    return normalize(left) === normalize(right);
}

function canonicalWorkspacePath(workspacePath: string) {
    try {
        return fs.realpathSync.native(workspacePath);
    } catch {
        return workspacePath;
    }
}

/** 将旧配置里的工作空间路径解析为绝对路径。 */
function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

/** 从当前包信息中读取 Canvas Agent 版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
