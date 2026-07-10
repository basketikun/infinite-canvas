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

export const en = { ...commonLocales, ...pages, config, canvas, errors } as const;

type NestedMessages<T> = T extends string ? string : { [K in keyof T]: NestedMessages<T[K]> };

export type TranslationDictionary = NestedMessages<typeof en>;
