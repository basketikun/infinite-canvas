import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Layers, Wand2, Bot, Database, Cpu } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface FeatureItem {
    id: string;
    title: string;
    subtitle: string;
    description: string;
    tags: string[];
    icon: any;
    color: string;
    bgGradient: string;
    mockupType: "canvas" | "ai" | "assistant" | "agent" | "assets";
}

const features: FeatureItem[] = [
    {
        id: "canvas",
        title: "无限拓扑画布底座",
        subtitle: "打破传统线性布局，自由连线探索无限创意",
        description: "提供无边界缩放与平移的极速画布。支持节点拖拽、连线关联上下文、微缩全局小地图、无缝撤销重做以及项目快捷导入导出。",
        tags: ["无限缩放", "节点连线", "全局小地图", "历史重做"],
        icon: Layers,
        color: "from-amber-400 to-orange-500",
        bgGradient: "from-orange-500/10 via-amber-500/5 to-transparent",
        mockupType: "canvas",
    },
    {
        id: "ai",
        title: "多模态 AI 生成矩阵",
        subtitle: "文生图、图生图、局部擦除重绘全场景覆盖",
        description: "直连任意 OpenAI 兼容 API 接口，灵活配置自定义模型与脚本调用。支持局部蒙版编辑、高精度 Upscale 放缩以及视频音频合成。",
        tags: ["文生图", "局部重绘", "图生图", "视频生成"],
        icon: Wand2,
        color: "from-orange-500 to-red-500",
        bgGradient: "from-red-500/10 via-orange-500/5 to-transparent",
        mockupType: "ai",
    },
    {
        id: "assistant",
        title: "画布侧边 AI 智能助手",
        subtitle: "围绕选中节点对话，生成结果无缝插回画布",
        description: "助手可感知画布上选中的图像与文本节点上下文。提供针对性的提示词优化建议与连线推理，生成的图像可一键置入画布最佳位置。",
        tags: ["节点感知", "实时推演", "一键生成", "上下文挂载"],
        icon: Bot,
        color: "from-yellow-400 to-amber-500",
        bgGradient: "from-yellow-500/10 via-amber-500/5 to-transparent",
        mockupType: "assistant",
    },
    {
        id: "agent",
        title: "本地 IDE Agent (MCP 协议)",
        subtitle: "把画布接入 Codex 与 Claude Code 编程大脑",
        description: "通过本机 Canvas Agent 桥接 MCP 协议，让你的开发 Agent 能感知、操作并自动化创建画布节点，解锁自动生成与批处理超能力。",
        tags: ["MCP 协议", "Codex 挂载", "Claude Code", "自动化流程"],
        icon: Cpu,
        color: "from-amber-500 to-orange-600",
        bgGradient: "from-amber-600/10 via-orange-600/5 to-transparent",
        mockupType: "agent",
    },
    {
        id: "assets",
        title: "素材沉淀与提示词灵感库",
        subtitle: "全量本地化持久化，私密资产随心调取",
        description: "内置开源提示词灵感库与 IndexedDB 高性能本地缓存。所有生成的视觉成果、精选参考图与文案节点均可分类归档为个人资产。",
        tags: ["本地 IndexedDB", "提示词预设", "资产卡片", "100% 隐私"],
        icon: Database,
        color: "from-orange-400 to-amber-500",
        bgGradient: "from-orange-400/10 via-amber-400/5 to-transparent",
        mockupType: "assets",
    },
];

export function FeaturesCarouselSection() {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const autoPlayRef = useRef<NodeJS.Timeout | null>(null);

    const nextSlide = () => {
        setCurrentIndex((prev) => (prev + 1) % features.length);
    };

    const prevSlide = () => {
        setCurrentIndex((prev) => (prev - 1 + features.length) % features.length);
    };

    useEffect(() => {
        if (isAutoPlaying) {
            autoPlayRef.current = setInterval(nextSlide, 5000);
        }
        return () => {
            if (autoPlayRef.current) clearInterval(autoPlayRef.current);
        };
    }, [isAutoPlaying, currentIndex]);

    const activeFeature = features[currentIndex];
    const FeatureIcon = activeFeature.icon;

    return (
        <section id="features" className="relative overflow-hidden bg-stone-950 py-24 text-stone-100">
            {/* Ambient Lighting */}
            <div className="pointer-events-none absolute left-1/2 top-0 h-96 w-full -translate-x-1/2 bg-gradient-to-b from-orange-500/10 via-transparent to-transparent blur-3xl" />

            <div className="mx-auto max-w-7xl px-6">
                {/* Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <Sparkles className="size-3.5" /> 核心特色功能
                    </div>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        全方位重构你的 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">AI 视觉工作流</span>
                    </h2>
                    <p className="mt-4 text-base text-stone-400 sm:text-lg">
                        探索灵感、连线推演、局部修改到资产沉淀，每一个节点都精细打磨。
                    </p>
                </div>

                {/* Main Carousel Area */}
                <div
                    className="relative mt-16 overflow-hidden rounded-3xl border border-stone-800 bg-stone-900/60 p-6 shadow-2xl backdrop-blur-xl sm:p-10 lg:p-12"
                    onMouseEnter={() => setIsAutoPlaying(false)}
                    onMouseLeave={() => setIsAutoPlaying(true)}
                >
                    <div className="grid items-center gap-10 lg:grid-cols-12">
                        {/* Left Info Column */}
                        <div className="space-y-6 lg:col-span-5">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeFeature.id}
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -15 }}
                                    transition={{ duration: 0.3 }}
                                    className="space-y-6"
                                >
                                    <div className={`inline-flex items-center gap-2.5 rounded-2xl bg-stone-800/80 px-4 py-2 text-sm font-semibold text-stone-100 border border-stone-700/60`}>
                                        <div className={`grid size-7 place-items-center rounded-xl bg-gradient-to-r ${activeFeature.color} text-stone-950`}>
                                            <FeatureIcon className="size-4" />
                                        </div>
                                        <span>{activeFeature.subtitle}</span>
                                    </div>

                                    <h3 className="text-2xl font-black text-stone-100 sm:text-3xl lg:text-4xl">
                                        {activeFeature.title}
                                    </h3>

                                    <p className="text-sm leading-relaxed text-stone-300 sm:text-base">
                                        {activeFeature.description}
                                    </p>

                                    {/* Feature Tags */}
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {activeFeature.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300"
                                            >
                                                #{tag}
                                            </span>
                                        ))}
                                    </div>
                                </motion.div>
                            </AnimatePresence>

                            {/* Carousel Navigation Buttons */}
                            <div className="flex items-center justify-between pt-6 border-t border-stone-800">
                                <div className="flex items-center gap-2">
                                    {features.map((f, idx) => (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => setCurrentIndex(idx)}
                                            className={`h-2 rounded-full transition-all duration-300 ${
                                                currentIndex === idx ? "w-8 bg-orange-500" : "w-2 bg-stone-700 hover:bg-stone-600"
                                            }`}
                                            aria-label={`切换到 Slide ${idx + 1}`}
                                        />
                                    ))}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={prevSlide}
                                        className="grid size-10 place-items-center rounded-full border border-stone-700 bg-stone-800 text-stone-300 transition hover:border-orange-500 hover:bg-stone-700 hover:text-white"
                                        aria-label="上一个功能"
                                    >
                                        <ChevronLeft className="size-5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={nextSlide}
                                        className="grid size-10 place-items-center rounded-full border border-stone-700 bg-stone-800 text-stone-300 transition hover:border-orange-500 hover:bg-stone-700 hover:text-white"
                                        aria-label="下一个功能"
                                    >
                                        <ChevronRight className="size-5" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Right Interactive Mockup Visual */}
                        <div className="relative lg:col-span-7">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeFeature.id}
                                    initial={{ opacity: 0, scale: 0.95, rotateY: 10 }}
                                    animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, rotateY: -10 }}
                                    transition={{ duration: 0.4 }}
                                    className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-stone-800 bg-stone-950 shadow-2xl"
                                >
                                    {/* Mockup Header Bar */}
                                    <div className="flex h-9 items-center justify-between border-b border-stone-800 bg-stone-900/90 px-4 text-xs text-stone-400">
                                        <div className="flex items-center gap-2">
                                            <span className="size-3 rounded-full bg-red-500/80" />
                                            <span className="size-3 rounded-full bg-yellow-500/80" />
                                            <span className="size-3 rounded-full bg-green-500/80" />
                                            <span className="ml-2 font-mono text-[11px] text-stone-500">
                                                infinite-canvas://{activeFeature.id}
                                            </span>
                                        </div>
                                        <span className="rounded bg-orange-500/20 px-2 py-0.5 font-mono text-[10px] text-orange-400">
                                            LIVE DEMO
                                        </span>
                                    </div>

                                    {/* Mockup Content Renderings */}
                                    <div className="relative flex h-[calc(100%-2.25rem)] w-full items-center justify-center p-6">
                                        {/* Canvas Mockup */}
                                        {activeFeature.mockupType === "canvas" && (
                                            <div className="relative h-full w-full rounded-xl border border-stone-800 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] p-4">
                                                <motion.div
                                                    animate={{ x: [0, 10, 0], y: [0, -5, 0] }}
                                                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                                    className="absolute left-6 top-6 w-48 rounded-xl border border-orange-500/40 bg-stone-900/90 p-3 shadow-xl backdrop-blur-md"
                                                >
                                                    <div className="text-xs font-semibold text-orange-400">提示词输入节点</div>
                                                    <div className="mt-1 text-[11px] text-stone-300">赛博朋克风未来城市，霓虹夜景，8k高清细节...</div>
                                                </motion.div>
                                                {/* Connection line */}
                                                <svg className="absolute inset-0 h-full w-full pointer-events-none">
                                                    <line x1="180" y1="60" x2="280" y2="130" stroke="#f97316" strokeWidth="2" strokeDasharray="4 4" />
                                                </svg>
                                                <motion.div
                                                    animate={{ scale: [1, 1.02, 1] }}
                                                    transition={{ duration: 3, repeat: Infinity }}
                                                    className="absolute right-8 bottom-8 w-56 rounded-xl border border-stone-700 bg-stone-900/90 p-3 shadow-xl backdrop-blur-md"
                                                >
                                                    <div className="flex items-center justify-between text-xs font-semibold text-stone-200">
                                                        <span>AI 生图渲染节点</span>
                                                        <span className="text-[10px] text-emerald-400">● 已完成</span>
                                                    </div>
                                                    <div className="mt-2 h-24 w-full rounded-lg bg-gradient-to-tr from-orange-600 via-amber-600 to-stone-800 grid place-items-center text-xs font-bold text-white shadow-inner">
                                                        [ 视觉图层预览 ]
                                                    </div>
                                                </motion.div>
                                            </div>
                                        )}

                                        {/* AI Multimodal Mockup */}
                                        {activeFeature.mockupType === "ai" && (
                                            <div className="grid h-full w-full grid-cols-2 gap-4">
                                                <div className="flex flex-col justify-between rounded-xl border border-stone-800 bg-stone-900/80 p-4">
                                                    <div className="text-xs font-bold text-orange-400">智能参数调节</div>
                                                    <div className="space-y-3 text-xs text-stone-300">
                                                        <div>
                                                            <div className="flex justify-between text-[11px] text-stone-400">
                                                                <span>CFG Scale</span>
                                                                <span>7.5</span>
                                                            </div>
                                                            <div className="mt-1 h-1.5 w-full rounded-full bg-stone-800">
                                                                <div className="h-full w-3/4 rounded-full bg-orange-500" />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="flex justify-between text-[11px] text-stone-400">
                                                                <span>采样步数 (Steps)</span>
                                                                <span>30</span>
                                                            </div>
                                                            <div className="mt-1 h-1.5 w-full rounded-full bg-stone-800">
                                                                <div className="h-full w-4/5 rounded-full bg-amber-500" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button className="w-full rounded-lg bg-orange-500 py-2 text-center text-xs font-bold text-stone-950 shadow-lg shadow-orange-500/20">
                                                        ✨ 立即生成
                                                    </button>
                                                </div>
                                                <div className="relative overflow-hidden rounded-xl border border-stone-700 bg-gradient-to-br from-stone-800 via-orange-950 to-stone-900 p-4 flex flex-col justify-end">
                                                    <div className="absolute inset-0 bg-[radial-gradient(#f97316_1px,transparent_1px)] [background-size:12px_12px] opacity-20" />
                                                    <div className="relative z-10 rounded-lg bg-stone-950/80 p-2.5 backdrop-blur-md">
                                                        <div className="text-xs font-bold text-white">局部蒙版区域</div>
                                                        <div className="text-[10px] text-stone-400">已选中 1024x1024 选区重绘</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Assistant Mockup */}
                                        {activeFeature.mockupType === "assistant" && (
                                            <div className="flex h-full w-full flex-col justify-between rounded-xl border border-stone-800 bg-stone-900/90 p-4">
                                                <div className="flex items-center gap-2 border-b border-stone-800 pb-3 text-xs font-bold text-stone-200">
                                                    <Bot className="size-4 text-orange-400" /> 画布助理 Copilot
                                                </div>
                                                <div className="space-y-3 overflow-y-auto py-2 text-xs">
                                                    <div className="rounded-lg bg-stone-800/80 p-2.5 text-stone-300 max-w-[85%]">
                                                        请帮我分析当前选中的图层，并提供 3 个渲染风格扩展提案。
                                                    </div>
                                                    <div className="ml-auto rounded-lg bg-orange-500/20 border border-orange-500/30 p-2.5 text-orange-200 max-w-[85%]">
                                                        已识别当前选中节点！建议尝试：1. 极简黑白灰 2. 赛博朋克高明度 3. 水彩风梦幻纹理。
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        readOnly
                                                        value="尝试生成水彩风分支节点..."
                                                        className="flex-1 rounded-lg border border-stone-700 bg-stone-950 px-3 py-1.5 text-xs text-stone-300"
                                                    />
                                                    <button className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-stone-950">
                                                        发送
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Agent Mockup */}
                                        {activeFeature.mockupType === "agent" && (
                                            <div className="h-full w-full rounded-xl border border-stone-800 bg-stone-950 p-4 font-mono text-xs text-stone-300">
                                                <div className="flex items-center justify-between border-b border-stone-800 pb-2 text-[11px] text-stone-500">
                                                    <span>mcp-server :: localhost:3000</span>
                                                    <span className="text-emerald-400">CONNECTED</span>
                                                </div>
                                                <div className="mt-3 space-y-1.5 text-[11px]">
                                                    <div className="text-orange-400">&gt; codex agent batch_create_nodes()</div>
                                                    <div className="text-stone-400">[MCP] Registering 4 nodes on infinite canvas...</div>
                                                    <div className="text-emerald-400">✔ Node #101 ImageNode [SUCCESS]</div>
                                                    <div className="text-emerald-400">✔ Node #102 TextNode [SUCCESS]</div>
                                                    <div className="text-amber-400">⚡ Connecting topological edge #101 -&gt; #102</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Assets Mockup */}
                                        {activeFeature.mockupType === "assets" && (
                                            <div className="grid h-full w-full grid-cols-3 gap-3">
                                                {[1, 2, 3].map((i) => (
                                                    <div key={i} className="flex flex-col justify-between rounded-xl border border-stone-800 bg-stone-900/80 p-3">
                                                        <div className="h-20 w-full rounded-lg bg-stone-800 bg-gradient-to-br from-orange-500/20 to-amber-500/10 flex items-center justify-center text-xs text-orange-400 font-bold">
                                                            预设 #{i}
                                                        </div>
                                                        <div className="text-[11px] font-medium text-stone-300 truncate">大师级光效参数</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
