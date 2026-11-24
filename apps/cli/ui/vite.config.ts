import { workbenchViteConfig } from "../../../packages/workbench/vite";

export default { ...workbenchViteConfig(new URL("./", import.meta.url)), base: "/" };
