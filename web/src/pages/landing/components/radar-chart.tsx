import { useState } from "react";
import { Check, ShieldCheck, Zap, Sparkles, Cpu, Lock } from "lucide-react";
import { motion } from "motion/react";

interface RadarMetric {
    label: string;
    infiniteCanvas: number;
    traditionalSaaS: number;
    legacyCanvas: number;
    description: string;
}

const metrics: RadarMetric[] = [
    {
        label: "交互自由度",
        infiniteCanvas: 100,
        traditionalSaaS: 55,
        legacyCanvas: 70,
        description: "无边界画布、任意节点拖拽、连线关联上下文与全局小地图",
    },
    {
        label: "隐私与数据安全",
        infiniteCanvas: 100,
        traditionalSaaS: 40,
        legacyCanvas: 50,
        description: "100% 浏览器本地 IndexedDB 存储，密钥本地闭环，无云端泄露隐患",
    },
    {
        label: "多模态 AI 矩阵",
        infiniteCanvas: 95,
        traditionalSaaS: 75,
        legacyCanvas: 60,
        description: "文生图、图生图、参考图局部重绘、音频与视频生成一体化集成",
    },
    {
        label: "Agent / MCP 扩展",
        infiniteCanvas: 95,
        traditionalSaaS: 20,
        legacyCanvas: 40,
        description: "原生 MCP 协议，支持 Codex / Claude Code 本地 Agent 操控画布",
    },
    {
        label: "使用成本与灵活性",
        infiniteCanvas: 100,
        traditionalSaaS: 50,
        legacyCanvas: 45,
        description: "零平台抽成，直连任意 OpenAI 兼容中转接口与自建模型",
    },
    {
        label: "响应与流畅度",
        infiniteCanvas: 95,
        traditionalSaaS: 70,
        legacyCanvas: 60,
        description: "纯前端静态架构 + 本地缓存，无中心化服务器延迟瓶颈",
    },
];

export function RadarChartSection() {
    const [hoveredMetricIndex, setHoveredMetricIndex] = useState<number | null>(null);

    // Radar SVG dimensions & layout math
    const size = 340;
    const center = size / 2;
    const radius = 120;
    const totalMetrics = metrics.length;

    // Helper to calculate (x, y) coordinates for angle & value
    const getCoordinates = (index: number, valuePercentage: number) => {
        const angle = (Math.PI * 2 * index) / totalMetrics - Math.PI / 2;
        const r = (radius * valuePercentage) / 100;
        return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle),
        };
    };

    // Generate path polygon string for a given key
    const getPolygonPath = (key: "infiniteCanvas" | "traditionalSaaS" | "legacyCanvas") => {
        return metrics
            .map((m, i) => {
                const { x, y } = getCoordinates(i, m[key]);
                return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .concat("Z")
            .join(" ");
    };

    // Concentric grid levels (20%, 40%, 60%, 80%, 100%)
    const levels = [0.2, 0.4, 0.6, 0.8, 1.0];

    return (
        <section id="comparison" className="relative overflow-hidden bg-stone-900 py-24 text-stone-100">
            {/* Background ambient lighting */}
            <div className="pointer-events-none absolute -left-40 top-1/4 size-96 rounded-full bg-orange-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -right-40 bottom-1/4 size-96 rounded-full bg-amber-500/10 blur-3xl" />

            <div className="mx-auto max-w-7xl px-6">
                {/* Section Title Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <Sparkles className="size-3.5" /> 竞品全方位对比
                    </div>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        为什么选择 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">无限画布</span>？
                    </h2>
                    <p className="mt-4 text-base text-stone-400 sm:text-lg">
                        突破传统 SaaS 平台的诸多限制，构建真正属于创作者的无限自由度 AI 工作台。
                    </p>
                </div>

                {/* Radar + Detailed Metrics grid */}
                <div className="mt-16 grid items-center gap-12 lg:grid-cols-12">
                    {/* Left 5 Cols: SVG Radar Chart */}
                    <div className="flex flex-col items-center justify-center lg:col-span-5">
                        <div className="relative grid place-items-center rounded-3xl border border-stone-800 bg-stone-950/80 p-6 shadow-2xl backdrop-blur-xl">
                            {/* Legend badges */}
                            <div className="mb-4 flex flex-wrap justify-center gap-4 text-xs font-medium">
                                <div className="flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/20 px-3 py-1 text-orange-300">
                                    <span className="size-2.5 rounded-full bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
                                    无限画布 (Infinite Canvas)
                                </div>
                                <div className="flex items-center gap-1.5 rounded-full border border-stone-700 bg-stone-800/80 px-3 py-1 text-stone-400">
                                    <span className="size-2.5 rounded-full bg-stone-500" />
                                    传统 SaaS 生图工具
                                </div>
                            </div>

                            {/* SVG Radar Rendering */}
                            <svg width={size} height={size} className="overflow-visible">
                                <defs>
                                    <radialGradient id="radarOrangeGlow" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                                        <stop offset="100%" stopColor="#ea580c" stopOpacity="0.1" />
                                    </radialGradient>
                                </defs>

                                {/* Concentric polygon grid */}
                                {levels.map((lvl) => {
                                    const gridPath = metrics
                                        .map((_, i) => {
                                            const { x, y } = getCoordinates(i, lvl * 100);
                                            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                                        })
                                        .concat("Z")
                                        .join(" ");

                                    return (
                                        <path
                                            key={lvl}
                                            d={gridPath}
                                            fill="none"
                                            stroke="#374151"
                                            strokeWidth="1"
                                            strokeDasharray={lvl === 1 ? "none" : "3 3"}
                                        />
                                    );
                                })}

                                {/* Radial axes lines */}
                                {metrics.map((_, i) => {
                                    const { x, y } = getCoordinates(i, 100);
                                    return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="#374151" strokeWidth="1" />;
                                })}

                                {/* Legacy SaaS Polygon */}
                                <motion.path
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    whileInView={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.8 }}
                                    d={getPolygonPath("traditionalSaaS")}
                                    fill="rgba(107, 114, 128, 0.15)"
                                    stroke="#6b7280"
                                    strokeWidth="1.5"
                                    strokeDasharray="4 4"
                                />

                                {/* Infinite Canvas Main Polygon */}
                                <motion.path
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    whileInView={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.8, delay: 0.2 }}
                                    d={getPolygonPath("infiniteCanvas")}
                                    fill="url(#radarOrangeGlow)"
                                    stroke="#f97316"
                                    strokeWidth="2.5"
                                    className="drop-shadow-[0_0_12px_rgba(249,115,22,0.6)]"
                                />

                                {/* Interactive Data Nodes & Labels */}
                                {metrics.map((m, i) => {
                                    const coord100 = getCoordinates(i, 118);
                                    const coordInfinite = getCoordinates(i, m.infiniteCanvas);
                                    const isHovered = hoveredMetricIndex === i;

                                    return (
                                        <g key={i} className="cursor-pointer" onMouseEnter={() => setHoveredMetricIndex(i)} onMouseLeave={() => setHoveredMetricIndex(null)}>
                                            {/* Data Point Dot */}
                                            <circle
                                                cx={coordInfinite.x}
                                                cy={coordInfinite.y}
                                                r={isHovered ? "6" : "4.5"}
                                                fill="#f97316"
                                                stroke="#ffffff"
                                                strokeWidth="2"
                                                className="transition-all duration-200"
                                            />

                                            {/* Outer Label text */}
                                            <text
                                                x={coord100.x}
                                                y={coord100.y}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                className={`text-[11px] font-medium transition-colors duration-200 ${
                                                    isHovered ? "fill-orange-400 font-bold" : "fill-stone-300"
                                                }`}
                                            >
                                                {m.label}
                                            </text>
                                        </g>
                                    );
                                })}
                            </svg>

                            {/* Active Hover Detail Tooltip */}
                            <div className="mt-4 h-14 w-full rounded-xl border border-stone-800 bg-stone-900/90 p-3 text-center text-xs text-stone-300">
                                {hoveredMetricIndex !== null ? (
                                    <div>
                                        <span className="font-semibold text-orange-400">{metrics[hoveredMetricIndex].label}</span>：
                                        {metrics[hoveredMetricIndex].description}
                                    </div>
                                ) : (
                                    <span className="text-stone-500">悬停雷达图顶点查看各项维度能力详解</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right 7 Cols: Detailed Interactive Comparison Matrix */}
                    <div className="space-y-4 lg:col-span-7">
                        {metrics.map((item, idx) => (
                            <motion.div
                                key={item.label}
                                initial={{ opacity: 0, x: 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.4, delay: idx * 0.08 }}
                                onMouseEnter={() => setHoveredMetricIndex(idx)}
                                onMouseLeave={() => setHoveredMetricIndex(null)}
                                className={`group rounded-2xl border p-5 transition-all duration-300 ${
                                    hoveredMetricIndex === idx
                                        ? "border-orange-500/50 bg-gradient-to-r from-orange-500/10 via-stone-900 to-stone-900 shadow-lg shadow-orange-500/5"
                                        : "border-stone-800/80 bg-stone-950/60 hover:border-stone-700"
                                }`}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-400 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                                            {idx === 0 && <Sparkles className="size-4" />}
                                            {idx === 1 && <Lock className="size-4" />}
                                            {idx === 2 && <Zap className="size-4" />}
                                            {idx === 3 && <Cpu className="size-4" />}
                                            {idx === 4 && <ShieldCheck className="size-4" />}
                                            {idx === 5 && <Check className="size-4" />}
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-stone-100 group-hover:text-orange-300 transition-colors">
                                                {item.label}
                                            </h3>
                                            <p className="mt-0.5 text-xs text-stone-400">{item.description}</p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3 text-right">
                                        <div className="text-right">
                                            <div className="text-xs font-semibold text-orange-400">无限画布 {item.infiniteCanvas}%</div>
                                            <div className="text-[11px] text-stone-500">传统SaaS {item.traditionalSaaS}%</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Comparison Bar */}
                                <div className="mt-3.5 relative h-2 w-full overflow-hidden rounded-full bg-stone-800">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        whileInView={{ width: `${item.infiniteCanvas}%` }}
                                        transition={{ duration: 0.8, delay: 0.2 + idx * 0.05 }}
                                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]"
                                    />
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Table Comparison Overview */}
                <div className="mt-16 overflow-hidden rounded-3xl border border-stone-800 bg-stone-950/70 shadow-2xl backdrop-blur-xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-stone-800 bg-stone-900/60 text-xs uppercase tracking-wider text-stone-400">
                                <tr>
                                    <th className="px-6 py-4">核心对比项</th>
                                    <th className="px-6 py-4 text-orange-400 font-bold">无限画布 (Infinite Canvas)</th>
                                    <th className="px-6 py-4">传统 Web 图像生成器</th>
                                    <th className="px-6 py-4">云端 SaaS 画布工具</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-800/60 text-stone-300">
                                <tr className="hover:bg-stone-900/40">
                                    <td className="px-6 py-4 font-semibold text-stone-200">数据与隐私安全</td>
                                    <td className="px-6 py-4 text-emerald-400 font-medium flex items-center gap-1.5">
                                        <Check className="size-4 text-emerald-400" /> 100% 浏览器本地存储
                                    </td>
                                    <td className="px-6 py-4 text-stone-500">云端强制集中化托管</td>
                                    <td className="px-6 py-4 text-stone-500">第三方云数据库上传</td>
                                </tr>
                                <tr className="hover:bg-stone-900/40">
                                    <td className="px-6 py-4 font-semibold text-stone-200">本地 Agent (MCP 协议)</td>
                                    <td className="px-6 py-4 text-emerald-400 font-medium flex items-center gap-1.5">
                                        <Check className="size-4 text-emerald-400" /> 原生支持 (Codex/Claude Code)
                                    </td>
                                    <td className="px-6 py-4 text-stone-500">不支持 API/MCP 接入</td>
                                    <td className="px-6 py-4 text-stone-500">仅限封闭云端 Assistant</td>
                                </tr>
                                <tr className="hover:bg-stone-900/40">
                                    <td className="px-6 py-4 font-semibold text-stone-200">API 接口扩展</td>
                                    <td className="px-6 py-4 text-emerald-400 font-medium flex items-center gap-1.5">
                                        <Check className="size-4 text-emerald-400" /> 自由配置 OpenAI 兼容/自定义中转
                                    </td>
                                    <td className="px-6 py-4 text-stone-500">绑定平台扣积分点数</td>
                                    <td className="px-6 py-4 text-stone-500">局限特定模型且高额溢价</td>
                                </tr>
                                <tr className="hover:bg-stone-900/40">
                                    <td className="px-6 py-4 font-semibold text-stone-200">多方案拓扑比较</td>
                                    <td className="px-6 py-4 text-emerald-400 font-medium flex items-center gap-1.5">
                                        <Check className="size-4 text-emerald-400" /> 无限二维拓扑节点连线
                                    </td>
                                    <td className="px-6 py-4 text-stone-500">单行线性历史记录列表</td>
                                    <td className="px-6 py-4 text-stone-500">简单网格卡片排列</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}
