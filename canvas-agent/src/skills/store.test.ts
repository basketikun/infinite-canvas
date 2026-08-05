import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SkillStore, SkillStoreError } from "./store.js";

test("创建、读取和更新画布专属 Skill", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);

    const created = await store.create({
        name: "product-grid",
        description: "生成商品九宫格",
        instructions: "根据商品信息创建九宫格生成流程。",
        interface: {
            displayName: "产品九宫格生成",
            shortDescription: "根据商品资料与参考图自动规划并生成产品图片九宫格流程",
            defaultPrompt: "Use $product-grid to build a product image grid.",
        },
    });
    assert.equal(created.managed, true);
    assert.equal(created.interface?.displayName, "产品九宫格生成");
    assert.equal(created.revision.length, 64);
    assert.equal(store.isManagedPath(created.path), true);
    const openAi = await fs.readFile(path.join(path.dirname(created.path), "agents", "openai.yaml"), "utf8");
    assert.match(openAi, /^interface:/m);
    assert.match(openAi, /display_name: "产品九宫格生成"/);

    const updated = await store.update("product-grid", {
        description: "生成商品图片九宫格",
        instructions: "先分析商品，再创建九宫格生成流程。",
        interface: { displayName: "产品九宫格生成" },
        expectedRevision: created.revision,
    });
    assert.equal(updated.description, "生成商品图片九宫格");
    assert.notEqual(updated.revision, created.revision);
    assert.deepEqual(updated.interface, { displayName: "产品九宫格生成" });
});

test("revision 不匹配时拒绝覆盖或删除", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({ name: "demo", description: "演示 Skill", instructions: "执行演示流程。" });

    await assert.rejects(store.update("demo", {
        description: "已过期的修改",
        instructions: "不会写入。",
        expectedRevision: "0".repeat(64),
    }), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 409);
    await assert.rejects(store.delete("demo", "0".repeat(64)), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 409);
    assert.equal((await store.get("demo")).revision, created.revision);
});

test("清空界面字段时保留未由画布管理的 openai 元数据", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({
        name: "metadata-demo",
        description: "演示界面元数据",
        instructions: "执行演示流程。",
        interface: { displayName: "演示", defaultPrompt: "Use $metadata-demo to run the demo." },
    });
    const openAiFile = path.join(path.dirname(created.path), "agents", "openai.yaml");
    await fs.writeFile(openAiFile, "interface:\n  display_name: 演示\n  default_prompt: Use $metadata-demo to run the demo.\n  icon_small: ./assets/icon.png\n  brand_color: '#336699'\n", "utf8");
    const current = await store.get("metadata-demo");

    const updated = await store.update("metadata-demo", {
        description: current.description,
        instructions: current.instructions,
        interface: null,
        expectedRevision: current.revision,
    });
    const openAi = await fs.readFile(openAiFile, "utf8");
    assert.equal(updated.interface, undefined);
    assert.match(openAi, /icon_small:/);
    assert.match(openAi, /brand_color:/);
    assert.doesNotMatch(openAi, /display_name:|default_prompt:/);
});

test("名称、正文大小和默认提示词均经过校验", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);

    await assert.rejects(store.create({ name: "Invalid_Name", description: "无效", instructions: "无效" }), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 400);
    await assert.rejects(store.create({ name: "invalid-description", description: "包含 <标签>", instructions: "无效" }), /尖括号/);
    await assert.rejects(store.create({ name: "too-large", description: "过大", instructions: "中".repeat(90_000) }), /256KiB/);
    await assert.rejects(store.create({
        name: "prompt-check",
        description: "校验默认提示词",
        instructions: "执行流程。",
        interface: { defaultPrompt: "Use this skill." },
    }), /\$prompt-check/);
    await assert.rejects(store.create({
        name: "prompt-check",
        description: "校验默认提示词边界",
        instructions: "执行流程。",
        interface: { defaultPrompt: "Use $prompt-check-extra instead." },
    }), /\$prompt-check/);
    await assert.rejects(store.create({
        name: "prompt-check",
        description: "校验命名空间提示词边界",
        instructions: "执行流程。",
        interface: { defaultPrompt: "Use $prompt-check:other instead." },
    }), /\$prompt-check/);
    await assert.rejects(store.create({
        name: "short-description-check",
        description: "校验卡片短说明长度",
        instructions: "执行流程。",
        interface: { shortDescription: "过短" },
    }), /不能少于 25 个字符/);
    await assert.rejects(store.create({
        name: "prompt-check",
        description: "校验默认提示词大小写",
        instructions: "执行流程。",
        interface: { defaultPrompt: "Use $PROMPT-CHECK instead." },
    }), /\$prompt-check/);
    await assert.rejects(store.create({
        name: "invalid-interface",
        description: "校验界面元数据",
        instructions: "执行流程。",
        interface: false as never,
    }), /界面元数据无效/);
});

test("更新校验失败时不会提前改写 SKILL.md", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({ name: "safe-update", description: "保留原内容", instructions: "执行原流程。" });

    await assert.rejects(store.update("safe-update", {
        description: "不应写入",
        instructions: "不应写入。",
        interface: { defaultPrompt: "缺少 Skill 名称" },
        expectedRevision: created.revision,
    }), /\$safe-update/);
    assert.deepEqual(await store.get("safe-update"), created);
});

test("拒绝读取非对象格式的 openai.yaml", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({ name: "invalid-metadata", description: "校验元数据", instructions: "执行流程。" });
    const agentsDir = path.join(path.dirname(created.path), "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(path.join(agentsDir, "openai.yaml"), "- invalid\n", "utf8");

    await assert.rejects(store.get("invalid-metadata"), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 409);
});

test("不完整更新请求返回校验错误而不是运行时异常", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);

    await assert.rejects(store.update("demo", undefined as never), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 400);
});

test("空 interface 元数据读取为空", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({ name: "empty-interface", description: "空界面元数据", instructions: "执行流程。" });
    const agentsDir = path.join(path.dirname(created.path), "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(path.join(agentsDir, "openai.yaml"), "interface: {}\n", "utf8");

    assert.equal((await store.get("empty-interface")).interface, undefined);
});

test("读取或修改不存在的 Skill 不会创建目录", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const skillsRoot = path.join(workspace, ".agents", "skills");

    await assert.rejects(store.get("missing"), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 404);
    await assert.rejects(store.update("missing", {
        description: "不存在",
        instructions: "不会写入。",
        expectedRevision: "0".repeat(64),
    }), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 404);
    await assert.rejects(store.delete("missing", "0".repeat(64)), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 404);
    await assert.rejects(fs.access(skillsRoot));
});

test("更新后只保留完整文件且不遗留临时文件", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({
        name: "atomic-update",
        description: "验证原子更新",
        instructions: "执行旧流程。",
        interface: { displayName: "原子更新" },
    });

    const updated = await store.update("atomic-update", {
        description: "验证完整更新",
        instructions: "执行新流程。",
        interface: { displayName: "完整更新" },
        expectedRevision: created.revision,
    });
    const skillDirectory = path.dirname(updated.path);
    const skillText = await fs.readFile(updated.path, "utf8");
    const openAiText = await fs.readFile(path.join(skillDirectory, "agents", "openai.yaml"), "utf8");
    assert.match(skillText, /description: 验证完整更新/);
    assert.match(skillText, /执行新流程/);
    assert.match(openAiText, /display_name: "完整更新"/);
    assert.deepEqual((await fs.readdir(skillDirectory)).filter((name) => name.endsWith(".tmp")), []);
    assert.deepEqual((await fs.readdir(path.join(skillDirectory, "agents"))).filter((name) => name.endsWith(".tmp")), []);
});

test("拒绝读取非对象格式的 interface 元数据", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-skill-store-"));
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new SkillStore(workspace);
    const created = await store.create({ name: "invalid-interface", description: "校验界面元数据", instructions: "执行流程。" });
    const agentsDir = path.join(path.dirname(created.path), "agents");
    await fs.mkdir(agentsDir);
    await fs.writeFile(path.join(agentsDir, "openai.yaml"), "interface: false\n", "utf8");

    await assert.rejects(store.get("invalid-interface"), (error: unknown) => error instanceof SkillStoreError && error.statusCode === 409);
});
