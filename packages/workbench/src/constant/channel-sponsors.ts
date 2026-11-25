export type ChannelSponsor = {
    id: string;
    name: string;
    description: string;
    baseUrl: string;
    website: string;
    logo: string;
};

export const channelSponsors: ChannelSponsor[] = [
    { id: "kunrouai", name: "坤肉AI", description: "AI 视觉创作与 API 开放平台", baseUrl: "https://api.kunrouai.com", website: "https://kunrouai.com/?utm_source=infinite-canvas", logo: "/sponsors/kunrouai.svg" },
    { id: "apimart", name: "APIMart", description: "低价图片、视频生成 API", baseUrl: "https://api.apimart.ai", website: "https://go.apimart.ai/gh-infinite-canvas", logo: "/sponsors/apimart.png" },
    { id: "atlascloud", name: "Atlas Cloud", description: "全模态 AI 推理平台", baseUrl: "https://api.atlascloud.ai", website: "https://www.atlascloud.ai/zh?utm_source=github&utm_medium=link&utm_campaign=infinite-canvas", logo: "/sponsors/atlascloud.svg" },
    { id: "metaso", name: "秘塔科技", description: "MiniMax H3 视频生成 API", baseUrl: "https://metaso.cn/api", website: "https://metaso.cn/minimax-h3/?s=inf", logo: "/sponsors/metaso.jpg" },
    { id: "88api", name: "88API", description: "无限画布深度优化分支", baseUrl: "https://88api.ai", website: "https://88api.ai/sign-up?aff=zbs9", logo: "/sponsors/88api.png" },
    { id: "infistar", name: "Infistar.ai 无限星河", description: "全能多模态 API", baseUrl: "https://www.infistar.cc", website: "https://www.infistar.cc/register?aff=4X3V9NA9&ref_source=link", logo: "/sponsors/infistar.png" },
    { id: "compshare", name: "优云智算", description: "H3 视频生成 API", baseUrl: "https://api.modelverse.cn", website: "https://www.compshare.cn/video-studio?ytag=GPU_YY_YX_git_infinite-canvas", logo: "/sponsors/compshare.svg" },
    { id: "packycode", name: "PackyCode", description: "稳定高效的 API 中转服务", baseUrl: "https://www.packyapi.com", website: "https://www.packyapi.com/register?aff=34VV", logo: "/sponsors/packycode.png" },
    { id: "heyroute", name: "HeyRoute", description: "全能多模态 API 服务商", baseUrl: "https://heyroute.ai", website: "https://heyroute.ai/basketikun", logo: "/sponsors/heyroute.svg" },
];
