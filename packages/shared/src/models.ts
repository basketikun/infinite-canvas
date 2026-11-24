export const modelCapabilities = ["image", "video", "text", "audio"] as const;
export type ModelCapability = typeof modelCapabilities[number];

export type ModelOption = {
    /**
     * 调用时使用的模型标识。
     */
    value: string;
    /**
     * 模型的显示名称。
     */
    label: string;
};

export type CallScript = {
    /**
     * 脚本库中的唯一标识，模型通过它选择调用方式。
     */
    id: string;
    /**
     * 在选择面板展示的名称。
     */
    name: string;
    /**
     * 帮助用户选择的简短说明。
     */
    description: string;
    /**
     * 可选的 Logo 地址或 data URL。
     */
    logo?: string;
    /**
     * 单色 Logo 在深色主题下反色。
     */
    invertInDark?: boolean;
    /**
     * 脚本唯一适用的用途。
     */
    capability: ModelCapability;
    /**
     * 当前用途的完整可编辑源码。
     */
    source: string;
};
