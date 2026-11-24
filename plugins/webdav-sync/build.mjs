import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";
await buildPlugin(import.meta.url, { publicDir: new URL("../../packages/workbench/public/plugins/", import.meta.url) });
