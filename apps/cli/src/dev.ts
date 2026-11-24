import { runCli } from "./cli.js";
import { createDevWeb } from "./dev-web.js";

await runCli({ create: createDevWeb }, import.meta.url);
