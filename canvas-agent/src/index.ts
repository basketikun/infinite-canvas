#!/usr/bin/env node
import { parseAgentIdentity } from "./agent/identity.js";
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";

if (process.argv[2] === "mcp") {
    try {
        await startMcpServer(parseAgentIdentity(process.argv.slice(3)));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
} else startHttpServer();
