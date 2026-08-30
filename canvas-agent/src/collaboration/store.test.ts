import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CollaborationStore } from "./store.js";

test("refuses to overwrite an unknown collaboration storage version", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-store-"));
    const file = path.join(directory, "sessions.json");
    try {
        await fs.writeFile(file, JSON.stringify({ version: 99, sessions: [] }));
        const store = new CollaborationStore(file);
        await assert.rejects(() => store.mutate((data) => data.sessions.push({} as never)), /版本未知/);
        assert.equal(JSON.parse(await fs.readFile(file, "utf8")).version, 99);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("refuses to overwrite a damaged collaboration manifest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-store-"));
    const file = path.join(directory, "sessions.json");
    try {
        await fs.writeFile(file, JSON.stringify({ version: 1, sessions: [{ id: "broken", members: [], tasks: [{}] }] }));
        const store = new CollaborationStore(file);
        await assert.rejects(() => store.mutate(() => undefined), /格式损坏/);
        assert.equal(JSON.parse(await fs.readFile(file, "utf8")).sessions[0].id, "broken");
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("refuses versioned collaboration data with missing required fields", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-store-"));
    const file = path.join(directory, "sessions.json");
    try {
        await fs.writeFile(file, JSON.stringify({ version: 1, sessions: [{ id: "incomplete", members: [], tasks: [] }] }));
        const store = new CollaborationStore(file);
        await assert.rejects(() => store.mutate(() => undefined), /格式损坏/);
        assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { version: 1, sessions: [{ id: "incomplete", members: [], tasks: [] }] });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
