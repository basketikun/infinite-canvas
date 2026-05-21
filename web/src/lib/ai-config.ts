export type AiConfig = {
  quality: string;
  size: string;
  count: string;
};

export const defaultConfig: AiConfig = {
  quality: "auto",
  size: "auto",
  count: "1",
};
