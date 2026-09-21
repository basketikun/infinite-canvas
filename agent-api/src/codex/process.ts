import { spawn, type ChildProcess } from "node:child_process";

import type { CodexTransport } from "./client.js";

export type SpawnCodexInput = {
    bin: string;
    cwd: string;
    codexHome: string;
    apiKey: string;
};

export function spawnCodexProcess(input: SpawnCodexInput): CodexTransport {
    const child = spawn(input.bin, ["app-server", "--stdio"], {
        cwd: input.cwd,
        env: {
            ...process.env,
            CODEX_HOME: input.codexHome,
            OPENAI_API_KEY: input.apiKey,
            CODEX_API_KEY: input.apiKey,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    return new ChildProcessTransport(child);
}

class ChildProcessTransport implements CodexTransport {
    private dataHandler: ((chunk: string) => void) | null = null;
    private exitHandler: ((error?: Error) => void) | null = null;
    private closed = false;

    constructor(private readonly child: ChildProcess) {
        child.stdout?.on("data", (chunk) => this.dataHandler?.(String(chunk)));
        child.on("error", (error) => this.exitHandler?.(error));
        child.on("exit", (code) => {
            if (this.closed) return;
            this.exitHandler?.(new Error(`Codex app-server exited: ${code ?? 0}`));
        });
    }

    write(line: string) {
        this.child.stdin?.write(`${line}\n`);
    }

    onData(handler: (chunk: string) => void) {
        this.dataHandler = handler;
    }

    onExit(handler: (error?: Error) => void) {
        this.exitHandler = handler;
    }

    dispose() {
        if (this.closed) return;
        this.closed = true;
        this.child.kill();
    }
}
