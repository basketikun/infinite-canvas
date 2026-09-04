import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_PROJECT_ID, createProject, ensureProjects, getProject, removeProject, updateProject, writeConfigFile, type CanvasAgentConfig } from "./config.js";

const sample: CanvasAgentConfig = { url: "http://127.0.0.1:17371", token: "test-token" };

function makeTempBase(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
}

// POSIX-only: chmod semantics differ on Windows, where these modes are advisory.
const posix = process.platform === "win32" ? { skip: true } : {};

test("writeConfigFile creates directory 0700 and file 0600", posix, () => {
    const base = makeTempBase();
    const dir = path.join(base, "nested-config");
    const file = path.join(dir, "canvas-agent.json");
    try {
        writeConfigFile(dir, file, sample);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile tightens existing loose permissions", posix, () => {
    const base = makeTempBase();
    const dir = path.join(base, "existing-config");
    const file = path.join(dir, "canvas-agent.json");
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    try {
        writeConfigFile(dir, file, sample);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile persists the config content", () => {
    const base = makeTempBase();
    const file = path.join(base, "canvas-agent.json");
    try {
        writeConfigFile(base, file, sample);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), sample);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-"));
process.env.CANVAS_AGENT_CONFIG_DIR = configRoot;

test("旧工作区迁入默认项目，独立项目目录和会话彼此隔离", async (context) => {
    const legacyDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "canvas-agent-legacy-"));
    const projectDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "canvas-agent-project-"));
    context.after(() => Promise.all([fsPromises.rm(configRoot, { recursive: true, force: true }), fsPromises.rm(legacyDirectory, { recursive: true, force: true }), fsPromises.rm(projectDirectory, { recursive: true, force: true })]));
    const config: CanvasAgentConfig = { url: "http://127.0.0.1:17371", token: "test", workspace: { workspacePath: legacyDirectory, activeThreadId: "legacy-thread" } };
    const projects = ensureProjects(config);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].id, DEFAULT_PROJECT_ID);
    assert.equal(projects[0].workspacePath, legacyDirectory);
    assert.equal(projects[0].activeThreadId, "legacy-thread");
    assert.equal(config.workspace, undefined);
    const project = createProject(config, { name: "独立项目", workspacePath: projectDirectory });
    const unnamedDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "canvas-agent-unnamed-project-"));
    context.after(() => fsPromises.rm(unnamedDirectory, { recursive: true, force: true }));
    const unnamedProject = createProject(config, { name: "", workspacePath: unnamedDirectory });
    assert.equal(unnamedProject.name, path.basename(unnamedDirectory));
    updateProject(config, project.id, { activeThreadId: "project-thread" });
    assert.equal(getProject(config, DEFAULT_PROJECT_ID).activeThreadId, "legacy-thread");
    assert.equal(getProject(config, project.id).activeThreadId, "project-thread");
    assert.throws(() => createProject(config, { name: "重复项目", workspacePath: projectDirectory }), /已关联/);
    assert.throws(() => createProject(config, { name: "相对路径", workspacePath: "relative-path" }), /绝对目录/);
    removeProject(config, project.id);
    assert.equal(getProject(config, DEFAULT_PROJECT_ID).workspacePath, legacyDirectory);
    assert.equal((await fsPromises.stat(projectDirectory)).isDirectory(), true);
    assert.throws(() => removeProject(config, DEFAULT_PROJECT_ID), /不可删除/);
});
