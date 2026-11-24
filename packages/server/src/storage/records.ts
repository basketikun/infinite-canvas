import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readDiskJson<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function writeDiskJson(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
        await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
}
