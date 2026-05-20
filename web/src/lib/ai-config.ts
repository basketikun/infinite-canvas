export type AiConfig = {
  quality: string;
  size: string;
  count: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export const CONFIG_STORE_VERSION = 2;

export const defaultConfig: AiConfig = {
  quality: "auto",
  size: "auto",
  count: "1",
};
