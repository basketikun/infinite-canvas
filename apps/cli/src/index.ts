#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";

await runCli({ directory: fileURLToPath(new URL("./ui/", import.meta.url)) }, import.meta.url);
