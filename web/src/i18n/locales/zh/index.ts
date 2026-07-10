import type { TranslationDictionary } from "../en";
import * as commonLocales from "./common";
import { canvas } from "./canvas";
import { config } from "./config";
import { errors } from "./errors";
import { pages } from "./pages";

export * from "./common";
export { canvas } from "./canvas";
export { config } from "./config";
export { errors } from "./errors";
export { pages } from "./pages";

export const zh = { ...commonLocales, ...pages, config, canvas, errors } as const satisfies TranslationDictionary;
