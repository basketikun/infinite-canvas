import { Palette, Code2, Layout, Video, Sparkles, UserCheck } from "lucide-react";
import { motion } from "motion/react";

interface Persona {
    title: string;
    role: string;
    icon: any;
    description: string;
    painPoint: string;
    solution: string;
    badge: string;
}

const personas: Persona[] = [
    {
        title: "视觉设计师 & 插画师",
        role: "探索视觉方案与连续分镜",
        icon: Palette,
        description: "需要快速验证多种画风与局部重绘，要求高自由度参考图对比。",
        painPoint: "传统图生图单张记录零散，难以横向对比多方案细节差异。",
        solution: "无限二维画布拓扑排版，连线直观关联参考图与局部擦除重绘。",
        badge: "设计必备",
    },
    {
        title: "AIGC 开发者 & 独立创作者",
        role: "自动化工作流与 Agent 编排",
        icon: Code2,
        description: "希望将 AI 生成能力接入代码或本地 IDE，实现自动化节点生成。",
        painPoint: "市面工具多为封闭 Web 应用，无法通过 API / MCP 协议本地联动。",
        solution: "原生 MCP 协议，支持 Codex / Claude Code 本地 Agent 操控画布。",
        badge: "极客首选",
    },
    {
        title: "产品经理 & UI/UX 专家",
        role: "头脑风暴与原型示意",
        icon: Layout,
        description: "快速将创意构想转换为直观的多模态原型与交互节点流程。",
        painPoint: "不同文本与图片素材存在多个工具之间，沟通切换成本极高。",
        solution: "在一个无限画布中统一编排文本、AI 图像、视频与侧边助手推演。",
        badge: "高效协作",
    },
    {
        title: "自媒体 & 内容运营者",
        role: "批量素材与封面图文生产",
        icon: Video,
        description: "快速产出海报、视频封面与图文文案，沉淀个人素材灵感库。",
        painPoint: "生成素材易丢失，每次重新调优提示词费时费力。",
        solution: "本地化 IndexedDB 资产库与分类提示词预设，一键调取历史高赞模板。",
        badge: "爆款加速",
    },
];

export function PersonasSection() {
    return (
        <section id="personas" className="relative bg-stone-900/60 py-24 text-stone-100 border-t border-stone-800/80">
            <div className="mx-auto max-w-7xl px-6">
                {/* Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <UserCheck className="size-3.5" /> 目标用户画像
                    </div>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        为谁而生的 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">无限画布</span>？
                    </h2>
                    <p className="mt-4 text-base text-stone-400 sm:text-lg">
                        精准契合多元创作者的核心痛点，赋能不同维度的生产力飞跃。
                    </p>
                </div>

                {/* Personas Grid */}
                <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                    {personas.map((p, idx) => {
                        const Icon = p.icon;
                        return (
                            <motion.div
                                key={p.title}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, delay: idx * 0.1 }}
                                className="group relative flex flex-col justify-between rounded-3xl border border-stone-800 bg-stone-950/70 p-6 shadow-xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:border-orange-500/50 hover:shadow-2xl hover:shadow-orange-500/10"
                            >
                                <div>
                                    {/* Top Header */}
                                    <div className="flex items-center justify-between">
                                        <div className="grid size-12 place-items-center rounded-2xl bg-orange-500/10 text-orange-400 group-hover:bg-orange-500 group-hover:text-stone-950 transition-colors duration-300">
                                            <Icon className="size-6" />
                                        </div>
                                        <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[11px] font-bold text-orange-400">
                                            {p.badge}
                                        </span>
                                    </div>

                                    <h3 className="mt-6 text-xl font-bold text-stone-100 group-hover:text-orange-300 transition-colors">
                                        {p.title}
                                    </h3>
                                    <p className="mt-1 text-xs font-medium text-orange-400/90">{p.role}</p>

                                    <p className="mt-4 text-xs text-stone-300 leading-relaxed">
                                        {p.description}
                                    </p>

                                    {/* Pain vs Solution Breakdown */}
                                    <div className="mt-6 space-y-3 pt-4 border-t border-stone-800/80 text-xs">
                                        <div className="rounded-xl bg-red-950/20 border border-red-500/20 p-2.5 text-stone-300">
                                            <span className="font-bold text-red-400">痛点：</span>
                                            {p.painPoint}
                                        </div>
                                        <div className="rounded-xl bg-emerald-950/20 border border-emerald-500/20 p-2.5 text-stone-300">
                                            <span className="font-bold text-emerald-400">方案：</span>
                                            {p.solution}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
