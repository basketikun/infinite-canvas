// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 JustinQiuck

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(pluginDir, "../../web");
const outputDir = path.join(pluginDir, "web");

if (!fs.existsSync(path.join(webDir, "package.json"))) {
    throw new Error("未找到仓库 web/ 源码，无法生成 DSH FreeCanvas 内置画布");
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
    npm,
    ["run", "build", "--", "--outDir", outputDir, "--emptyOutDir"],
    { cwd: webDir, env: { ...process.env, VITE_BASE: "/dsh-freecanvas/" }, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
