export type StorageCategory = {
    /**
     * 分类的稳定标识，与实际目录或表名无关。
     */
    id: string;
    /**
     * 面向用户的分类名称。
     */
    label: string;
    /**
     * 内容展示方式；summary 仅展示占用，不提供内容读取。
     */
    kind: "records" | "images" | "media" | "summary";
};

export type StorageCategoryUsage = StorageCategory & {
    /**
     * 可浏览内容的数量；汇总分类为实际文件或记录数量。
     */
    records: number;
    /**
     * 分类占用的字节数。
     */
    bytes: number;
};

export type StorageUsage = {
    /**
     * 统计范围，用于区分浏览器额度和工作区所在磁盘。
     */
    scope: "browser" | "workspace";
    /**
     * 所有分类占用之和；不等同于所在磁盘已用空间。
     */
    contentBytes: number;
    /**
     * 浏览器站点或所在磁盘的已用空间，无法获取时为 null。
     */
    usedBytes: number | null;
    /**
     * 浏览器站点额度或所在磁盘容量，无法获取时为 null。
     */
    totalBytes: number | null;
    /**
     * 当前用户可用的空间，无法获取时为 null。
     */
    availableBytes: number | null;
    /**
     * 分类占用和可浏览内容。
     */
    categories: StorageCategoryUsage[];
};

export type StorageEntry = {
    /**
     * 内容在分类中的标识。
     */
    key: string;
    /**
     * 文件原名或内容标识。
     */
    name: string;
    /**
     * 文件正文或记录的字节数。
     */
    bytes: number;
    /**
     * 文件的媒体类型，普通记录为 null。
     */
    mimeType: string | null;
};

export const storageCategoryInfo = {
    state: { label: "应用数据", kind: "records" },
    projects: { label: "画布项目", kind: "records" },
    works: { label: "独立作品", kind: "records" },
    preferences: { label: "显示偏好", kind: "records" },
    images: { label: "图片文件", kind: "images" },
    previews: { label: "图片缩略图", kind: "images" },
    media: { label: "音视频文件", kind: "media" },
    imageRecords: { label: "生图记录", kind: "records" },
    videoRecords: { label: "视频记录", kind: "records" },
    audioRecords: { label: "音频记录", kind: "records" },
    agentRecords: { label: "Agent 记录", kind: "records" },
    chats: { label: "助手消息", kind: "records" },
    promptCache: { label: "提示词缓存", kind: "records" },
    library: { label: "素材库", kind: "records" },
    scripts: { label: "调用脚本", kind: "records" },
    pluginPackages: { label: "已安装插件", kind: "summary" },
    pluginData: { label: "插件数据", kind: "summary" },
    private: { label: "私有配置与任务", kind: "summary" },
    other: { label: "其他文件", kind: "summary" },
} satisfies Record<string, Pick<StorageCategory, "label" | "kind">>;
