import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_INSTRUCTIONS_BYTES = 256 * 1024;
const MAX_DISPLAY_NAME_LENGTH = 64;
const MIN_SHORT_DESCRIPTION_LENGTH = 25;
const MAX_SHORT_DESCRIPTION_LENGTH = 64;
const MAX_DEFAULT_PROMPT_LENGTH = 1024;

export type ManagedSkillInterface = {
    displayName?: string;
    shortDescription?: string;
    defaultPrompt?: string;
};

export type ManagedSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: ManagedSkillInterface;
    path: string;
    revision: string;
    managed: true;
};

export type CreateManagedSkillInput = {
    name: string;
    description: string;
    instructions: string;
    interface?: ManagedSkillInterface | null;
};

export type UpdateManagedSkillInput = {
    description: string;
    instructions: string;
    interface?: ManagedSkillInterface | null;
    expectedRevision: string;
};

type SkillDocument = {
    raw: string;
    frontmatter: Record<string, unknown>;
    description: string;
    instructions: string;
};

type OpenAiDocument = { raw: string; data: Record<string, unknown>; interface?: ManagedSkillInterface };

export class SkillStoreError extends Error {
    override name = "SkillStoreError";
    constructor(message: string, readonly statusCode: 400 | 404 | 409 | 500) {
        super(message);
    }
}

/** 只管理站点工作空间下 `.agents/skills` 中的画布专属 Skill。 */
export class SkillStore {
    readonly workspacePath: string;
    readonly skillsPath: string;
    private writeQueue: Promise<unknown> = Promise.resolve();

    constructor(workspacePath: string) {
        this.workspacePath = path.resolve(workspacePath);
        this.skillsPath = path.join(this.workspacePath, ".agents", "skills");
    }

    /** 判断 Codex 返回的绝对路径是否属于本 Store 的标准 Skill 入口。 */
    isManagedPath(filePath: string) {
        if (!path.isAbsolute(filePath)) return false;
        const relative = path.relative(this.skillsPath, path.resolve(filePath));
        const segments = relative.split(path.sep);
        return segments.length === 2 && validName(segments[0]) && segments[1].toLowerCase() === "skill.md";
    }

    /** 读取一个可编辑 Skill 的正文与界面元数据。 */
    async get(name: string): Promise<ManagedSkillDetail> {
        try {
            await this.writeQueue.catch(() => undefined);
            const paths = await this.safeExistingPaths(name);
            return await this.readDetail(name, paths.skillFile, paths.openAiFile);
        } catch (error) {
            throw storeError(error, "读取 Skill 失败");
        }
    }

    /** 创建新的画布专属 Skill。 */
    create(input: CreateManagedSkillInput) {
        return this.mutate(async () => {
            const name = skillName(input?.name);
            const description = skillDescription(input?.description);
            const instructions = skillInstructions(input?.instructions);
            const skillInterface = skillInterfaceValue(input?.interface, name);
            await this.ensureRoot();
            const skillDir = path.join(this.skillsPath, name);
            const existing = await lstatOptional(skillDir);
            if (existing) {
                if (existing.isSymbolicLink()) throw new SkillStoreError("Skill 目录不能是符号链接或目录联接", 400);
                throw new SkillStoreError("同名 Skill 已存在", 409);
            }
            await fs.mkdir(skillDir);
            try {
                const skillFile = path.join(skillDir, "SKILL.md");
                await writeFileAtomic(skillFile, serializeSkill({ name, description }, instructions));
                const openAiFile = path.join(skillDir, "agents", "openai.yaml");
                if (skillInterface) await this.writeOpenAi(openAiFile, {}, skillInterface);
                return await this.readDetail(name, skillFile, openAiFile);
            } catch (error) {
                await fs.rm(skillDir, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
        });
    }

    /** 通过 revision 防止覆盖已被其他窗口或外部编辑器修改的内容。 */
    update(nameValue: string, input: UpdateManagedSkillInput) {
        return this.mutate(async () => {
            const name = skillName(nameValue);
            const description = skillDescription(input?.description);
            const instructions = skillInstructions(input?.instructions);
            const expectedRevision = expectedRevisionValue(input?.expectedRevision);
            const interfaceInput = input?.interface;
            const skillInterface = interfaceInput === undefined ? undefined : skillInterfaceValue(interfaceInput, name);
            const paths = await this.safeExistingPaths(name);
            const currentSkill = await readSkill(paths.skillFile, name);
            const currentOpenAi = await readOpenAi(paths.openAiFile, name);
            assertRevision(expectedRevision, revision(currentSkill.raw, currentOpenAi.raw));
            const frontmatter = { ...currentSkill.frontmatter, name, description };
            await writeFileAtomic(paths.skillFile, serializeSkill(frontmatter, instructions));
            if (interfaceInput !== undefined) {
                try {
                    await this.writeOpenAi(paths.openAiFile, currentOpenAi.data, skillInterface);
                } catch (error) {
                    if (!await restoreSkillFiles(paths.skillFile, currentSkill.raw, paths.openAiFile, currentOpenAi.raw)) {
                        throw new SkillStoreError("Skill 更新失败且无法完全恢复，请检查本地文件", 500);
                    }
                    throw error;
                }
            }
            return await this.readDetail(name, paths.skillFile, paths.openAiFile);
        });
    }

    /** 删除 revision 仍匹配的画布专属 Skill。 */
    delete(nameValue: string, expectedRevisionValueInput: string) {
        return this.mutate(async () => {
            const name = skillName(nameValue);
            const expectedRevision = expectedRevisionValue(expectedRevisionValueInput);
            const paths = await this.safeExistingPaths(name);
            const currentSkill = await readSkill(paths.skillFile, name);
            const currentOpenAi = await readOpenAi(paths.openAiFile, name);
            assertRevision(expectedRevision, revision(currentSkill.raw, currentOpenAi.raw));
            await assertTreeHasNoLinks(paths.skillDir);
            const realRoot = await fs.realpath(this.skillsPath);
            const realSkill = await fs.realpath(paths.skillDir);
            if (!inside(realRoot, realSkill)) throw new SkillStoreError("Skill 路径不安全", 400);
            await fs.rm(realSkill, { recursive: true });
        });
    }

    private mutate<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.catch(() => undefined).then(operation).catch((error) => { throw storeError(error, "修改 Skill 失败"); });
        this.writeQueue = result.catch(() => undefined);
        return result;
    }

    private async ensureRoot() {
        const workspace = await lstatOptional(this.workspacePath);
        if (!workspace) throw new SkillStoreError("站点工作空间不存在", 409);
        if (workspace.isSymbolicLink()) throw new SkillStoreError("站点工作空间不能是符号链接或目录联接", 400);
        if (!workspace.isDirectory()) throw new SkillStoreError("站点工作空间不是目录", 409);
        const agentsPath = path.join(this.workspacePath, ".agents");
        await ensurePlainDirectory(agentsPath);
        await ensurePlainDirectory(this.skillsPath);
        const realWorkspace = await fs.realpath(this.workspacePath);
        const realRoot = await fs.realpath(this.skillsPath);
        if (!inside(realWorkspace, realRoot)) throw new SkillStoreError("Skill 根目录不安全", 400);
    }

    private async safeExistingPaths(nameValue: string) {
        const name = skillName(nameValue);
        await this.assertExistingRoot();
        const skillDir = path.join(this.skillsPath, name);
        const directory = await lstatOptional(skillDir);
        if (!directory) throw new SkillStoreError("找不到指定 Skill", 404);
        if (directory.isSymbolicLink() || !directory.isDirectory()) throw new SkillStoreError("Skill 目录不安全", 400);
        const realRoot = await fs.realpath(this.skillsPath);
        const realSkill = await fs.realpath(skillDir);
        if (!inside(realRoot, realSkill)) throw new SkillStoreError("Skill 路径不安全", 400);
        const skillFile = path.join(skillDir, "SKILL.md");
        const skillEntry = await lstatOptional(skillFile);
        if (!skillEntry) throw new SkillStoreError("Skill 缺少 SKILL.md", 404);
        if (skillEntry.isSymbolicLink() || !skillEntry.isFile()) throw new SkillStoreError("SKILL.md 路径不安全", 400);
        const agentsDir = path.join(skillDir, "agents");
        const agentsEntry = await lstatOptional(agentsDir);
        if (agentsEntry && (agentsEntry.isSymbolicLink() || !agentsEntry.isDirectory())) throw new SkillStoreError("Skill agents 目录不安全", 400);
        const openAiFile = path.join(agentsDir, "openai.yaml");
        const openAiEntry = await lstatOptional(openAiFile);
        if (openAiEntry && (openAiEntry.isSymbolicLink() || !openAiEntry.isFile())) throw new SkillStoreError("openai.yaml 路径不安全", 400);
        return { skillDir, skillFile, openAiFile };
    }

    private async assertExistingRoot() {
        const workspace = await lstatOptional(this.workspacePath);
        if (!workspace) throw new SkillStoreError("找不到指定 Skill", 404);
        if (workspace.isSymbolicLink()) throw new SkillStoreError("站点工作空间不能是符号链接或目录联接", 400);
        if (!workspace.isDirectory()) throw new SkillStoreError("找不到指定 Skill", 404);
        const agentsPath = path.join(this.workspacePath, ".agents");
        const agents = await lstatOptional(agentsPath);
        const root = await lstatOptional(this.skillsPath);
        if (!agents || !root) throw new SkillStoreError("找不到指定 Skill", 404);
        if (agents.isSymbolicLink() || !agents.isDirectory() || root.isSymbolicLink() || !root.isDirectory()) throw new SkillStoreError("Skill 路径中存在符号链接或目录联接", 400);
        const realWorkspace = await fs.realpath(this.workspacePath);
        const realRoot = await fs.realpath(this.skillsPath);
        if (!inside(realWorkspace, realRoot)) throw new SkillStoreError("Skill 根目录不安全", 400);
    }

    private async readDetail(name: string, skillFile: string, openAiFile: string): Promise<ManagedSkillDetail> {
        const skill = await readSkill(skillFile, name);
        const openAi = await readOpenAi(openAiFile, name);
        return {
            name,
            description: skill.description,
            instructions: skill.instructions,
            ...(openAi.interface ? { interface: openAi.interface } : {}),
            path: skillFile,
            revision: revision(skill.raw, openAi.raw),
            managed: true,
        };
    }

    private async writeOpenAi(filePath: string, current: Record<string, unknown>, skillInterface?: ManagedSkillInterface) {
        const agentsDir = path.dirname(filePath);
        const existing = recordValue(current.interface);
        delete existing.display_name;
        delete existing.short_description;
        delete existing.default_prompt;
        const interfaceYaml = {
            ...existing,
            ...(skillInterface?.displayName ? { display_name: skillInterface.displayName } : {}),
            ...(skillInterface?.shortDescription ? { short_description: skillInterface.shortDescription } : {}),
            ...(skillInterface?.defaultPrompt ? { default_prompt: skillInterface.defaultPrompt } : {}),
        };
        const next = { ...current };
        if (Object.keys(interfaceYaml).length) next.interface = interfaceYaml;
        else delete next.interface;
        if (Object.keys(next).length) {
            await ensurePlainDirectory(agentsDir);
            await writeFileAtomic(filePath, stringifyYaml(next, { defaultKeyType: "PLAIN", defaultStringType: "QUOTE_DOUBLE" }));
        } else {
            await fs.unlink(filePath).catch((error) => {
                if (nodeErrorCode(error) !== "ENOENT") throw error;
            });
        }
    }
}

function validName(value: string | undefined): value is string {
    return Boolean(value && value.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(value));
}

function skillName(value: unknown) {
    const name = typeof value === "string" ? value : "";
    if (!validName(name)) throw new SkillStoreError("Skill 名称只能包含小写字母、数字和连字符", 400);
    return name;
}

function skillDescription(value: unknown) {
    const description = typeof value === "string" ? value.trim() : "";
    if (!description) throw new SkillStoreError("请输入 Skill 描述", 400);
    if (description.length > MAX_DESCRIPTION_LENGTH) throw new SkillStoreError("Skill 描述过长", 400);
    if (description.includes("<") || description.includes(">")) throw new SkillStoreError("Skill 描述不能包含尖括号", 400);
    return description;
}

function skillInstructions(value: unknown) {
    const instructions = typeof value === "string" ? value.trim() : "";
    if (!instructions) throw new SkillStoreError("请输入 Skill 正文", 400);
    if (Buffer.byteLength(instructions, "utf8") > MAX_INSTRUCTIONS_BYTES) throw new SkillStoreError("Skill 正文不能超过 256KiB", 400);
    return instructions;
}

function skillInterfaceValue(value: unknown, name: string): ManagedSkillInterface | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) throw new SkillStoreError("Skill 界面元数据无效", 400);
    const interfaceValue = value as Record<string, unknown>;
    const displayName = optionalText(interfaceValue.displayName, "显示名称", MAX_DISPLAY_NAME_LENGTH);
    const shortDescription = optionalText(interfaceValue.shortDescription, "简短描述", MAX_SHORT_DESCRIPTION_LENGTH);
    const defaultPrompt = optionalText(interfaceValue.defaultPrompt, "默认提示词", MAX_DEFAULT_PROMPT_LENGTH);
    if (shortDescription && shortDescription.length < MIN_SHORT_DESCRIPTION_LENGTH) throw new SkillStoreError(`简短描述不能少于 ${MIN_SHORT_DESCRIPTION_LENGTH} 个字符`, 400);
    if (defaultPrompt && !new RegExp(`\\$${name}(?![A-Za-z0-9_-]|:[A-Za-z0-9_-])`).test(defaultPrompt)) throw new SkillStoreError(`默认提示词必须包含 $${name}`, 400);
    return displayName || shortDescription || defaultPrompt ? { ...(displayName ? { displayName } : {}), ...(shortDescription ? { shortDescription } : {}), ...(defaultPrompt ? { defaultPrompt } : {}) } : undefined;
}

function optionalText(value: unknown, label: string, maxLength: number) {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw new SkillStoreError(`${label}格式无效`, 400);
    const text = value.trim();
    if (text.length > maxLength) throw new SkillStoreError(`${label}过长`, 400);
    return text || undefined;
}

function expectedRevisionValue(value: unknown) {
    const expected = typeof value === "string" ? value : "";
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new SkillStoreError("Skill revision 无效，请重新加载后再试", 400);
    return expected;
}

function assertRevision(expected: string, current: string) {
    if (expected !== current) throw new SkillStoreError("Skill 已被其他窗口或外部编辑器修改，请重新加载后再试", 409);
}

function serializeSkill(frontmatter: Record<string, unknown>, instructions: string) {
    return matter.stringify(`${instructions.trim()}\n`, frontmatter);
}

async function readSkill(filePath: string, expectedName: string): Promise<SkillDocument> {
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: matter.GrayMatterFile<string>;
    try {
        parsed = matter(raw);
    } catch {
        throw new SkillStoreError("SKILL.md frontmatter 格式无效", 409);
    }
    const frontmatter = recordValue(parsed.data);
    if (frontmatter.name !== expectedName) throw new SkillStoreError("SKILL.md 中的名称与目录不一致", 409);
    return {
        raw,
        frontmatter,
        description: skillDescription(frontmatter.description),
        instructions: skillInstructions(parsed.content),
    };
}

async function readOpenAi(filePath: string, expectedName: string): Promise<OpenAiDocument> {
    const entry = await lstatOptional(filePath);
    if (!entry) return { raw: "", data: {} };
    const raw = await fs.readFile(filePath, "utf8");
    let data: Record<string, unknown>;
    try {
        const parsed = parseYaml(raw);
        if (parsed !== null && parsed !== undefined && (typeof parsed !== "object" || Array.isArray(parsed))) throw new Error("invalid document");
        data = recordValue(parsed);
    } catch {
        throw new SkillStoreError("agents/openai.yaml 格式无效", 409);
    }
    if (data.interface !== undefined && data.interface !== null && (typeof data.interface !== "object" || Array.isArray(data.interface))) {
        throw new SkillStoreError("agents/openai.yaml interface 格式无效", 409);
    }
    const value = data.interface as Record<string, unknown> | null | undefined;
    const skillInterface = skillInterfaceValue({ displayName: value?.display_name, shortDescription: value?.short_description, defaultPrompt: value?.default_prompt }, expectedName);
    return { raw, data, ...(skillInterface ? { interface: skillInterface } : {}) };
}

async function restoreSkillFiles(skillFile: string, skillRaw: string, openAiFile: string, openAiRaw: string) {
    try {
        await writeFileAtomic(skillFile, skillRaw);
        if (openAiRaw) {
            await ensurePlainDirectory(path.dirname(openAiFile));
            await writeFileAtomic(openAiFile, openAiRaw);
        } else {
            await fs.unlink(openAiFile).catch((error) => {
                if (nodeErrorCode(error) !== "ENOENT") throw error;
            });
        }
        return true;
    } catch {
        return false;
    }
}

async function writeFileAtomic(filePath: string, content: string) {
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
        await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
        await fs.rename(temporary, filePath);
    } finally {
        await fs.unlink(temporary).catch((error) => {
            if (nodeErrorCode(error) !== "ENOENT") throw error;
        });
    }
}

function revision(skillRaw: string, openAiRaw: string) {
    return crypto.createHash("sha256").update(skillRaw).update("\0").update(openAiRaw).digest("hex");
}

async function ensurePlainDirectory(directory: string) {
    const entry = await lstatOptional(directory);
    if (!entry) {
        await fs.mkdir(directory);
        return;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new SkillStoreError("Skill 路径中存在符号链接或目录联接", 400);
}

async function assertTreeHasNoLinks(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const metadata = await fs.lstat(entryPath);
        if (metadata.isSymbolicLink()) throw new SkillStoreError("Skill 目录中存在符号链接或目录联接，无法删除", 400);
        if (metadata.isDirectory()) await assertTreeHasNoLinks(entryPath);
    }
}

function inside(parent: string, child: string) {
    const relative = path.relative(parent, child);
    return Boolean(relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function lstatOptional(filePath: string) {
    try {
        return await fs.lstat(filePath);
    } catch (error) {
        if (nodeErrorCode(error) === "ENOENT") return undefined;
        throw error;
    }
}

function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function nodeErrorCode(error: unknown) {
    return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}

function storeError(error: unknown, fallback: string) {
    if (error instanceof SkillStoreError) return error;
    if (nodeErrorCode(error) === "ENOENT") return new SkillStoreError("找不到指定 Skill", 404);
    if (["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(nodeErrorCode(error))) return new SkillStoreError("Skill 文件当前无法修改", 409);
    return new SkillStoreError(fallback, 500);
}
