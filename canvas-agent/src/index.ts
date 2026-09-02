#!/usr/bin/env node
import { startHttpServer, createAgentApp } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";

export { createAgentApp, startHttpServer };

if (process.argv[2] === "mcp") await startMcpServer();
else startHttpServer();
