import { useState } from "react";
import { Check, ShieldCheck, Zap, Sparkles, Cpu, Lock, X, Layers, Sliders } from "lucide-react";
import { motion } from "motion/react";

interface RadarMetric {
    label: string;
    infiniteCanvas: number;
    traditionalSaaS: number;
    description: string;
}

const metrics: RadarMetric[] = [
    {
        label: "交互自由度",
        infiniteCanvas: 100,
        traditionalSaaS: 55,
        description: "无边界画布、任意节点拖拽拓扑与小地图",
    },
    {
        label: "数据隐私",
        infiniteCanvas: 100,
        traditionalSaaS: 40,
        description: "100% 本地 IndexedDB 存储，密钥极速闭环",
    },
    {
        label: "多模态矩阵",
        infiniteCanvas: 95,
        traditionalSaaS: 75,
        description: "文/图/视频/音频与局部蒙版重绘全涵盖",
    },
    {
        label: "MCP 扩展",
        infiniteCanvas: 95,
        traditionalSaaS: 20,
        description: "Codex / Claude Code 本地 Agent 操控",
    },
    {
        label: "零平台抽成",
        infiniteCanvas: 100,
        traditionalSaaS: 50,
        description: "直连任意 OpenAI 兼容中转与自建模型",
    },
    {
        label: "极速流畅",
        infiniteCanvas: 95,
        traditionalSaaS: 70,
        description: "纯前端静态架构，本地离线可平滑运行",
    },
];

const comparisonRows = [
    {
        feature: "数据与隐私安全",
        icon: Lock,
        infiniteCanvas: "100% 浏览器本地 IndexedDB 存储，密钥不上传",
        traditionalSaaS: "云端集中托管，隐私泄露风险",
    },
    {
        feature: "本地 Agent (MCP 协议)",
        icon: Cpu,
        infiniteCanvas: "原生支持 Codex / Claude Code 本地 Agent 操控",
        traditionalSaaS: "不支持本地 API/MCP 自动化接入",
    },
    {
        feature: "API 接口扩展",
        icon: Zap,
        infiniteCanvas: "自由配置任意 OpenAI 兼容 API / 本地 Ollama",
        traditionalSaaS: "强制绑定平台积分扣费，溢价高",
    },
    {
        feature: "多方案拓扑比较",
        icon: Layers,
        infiniteCanvas: "无限二维拓扑节点、自由连线与全局小地图",
        traditionalSaaS: "单行线性历史生成记录，难以直观对比",
    },
];

export function RadarChartSection() {
    const [hoveredMetricIndex, setHoveredMetricIndex] = useState<number | null>(null);

    // Compact SVG Radar Settings
    const size = 220;
    const center = size / 2;
    const radius = 75;
    const totalMetrics = metrics.length;

    const getCoordinates = (index: number, valuePercentage: number) => {
        const angle = (Math.PI * 2 * index) / totalMetrics - Math.PI / 2;
        const r = (radius * valuePercentage) / 100;
        return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle),
        };
    };

    const getPolygonPath = (key: "infiniteCanvas" | "traditionalSaaS") => {
        return metrics
            .map((m, i) => {
                const { x, y } = getCoordinates(i, m[key]);
                return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .concat("Z")
            .join(" ");
    };

    const levels = [0.33, 0.66, 1.0];

    return (
        <section id="comparison" className="relative overflow-hidden bg-stone-950 py-12 sm:py-16 text-stone-100 border-t border-stone-800/80">
            {/* Ambient Lighting */}
            <div className="pointer-events-none absolute -left-40 top-1/2 size-72 rounded-full bg-orange-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -right-40 bottom-10 size-72 rounded-full bg-amber-500/10 blur-3xl" />

            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Compact Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <Sparkles className="size-3.5" /> 竞品全方位对比
                    </div>

                    <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
                        为什么选择 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">无限画布</span>？
                    </h2>

                    <p className="mt-2 text-xs sm:text-sm text-stone-400">
                        突破传统 SaaS 平台的诸多限制，构建真正属于创作者的无限自由度 AI 工作台。
                    </p>
                </div>

                {/* Compact Side-by-Side Comparison Layout */}
                <div className="mt-8 grid items-stretch gap-6 lg:grid-cols-12">
                    {/* Left Column: Compact Radar Chart Card (5 cols) */}
                    <div className="flex flex-col justify-between rounded-2xl border border-stone-800 bg-stone-900/80 p-5 shadow-xl backdrop-blur-xl lg:col-span-5">
                        <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                            <div className="flex items-center gap-2">
                                <Sliders className="size-4 text-orange-400" />
                                <span className="text-xs font-bold text-stone-200">能力拓扑图谱</span>
                            </div>

                            <div className="flex items-center gap-2.5 text-[10px] font-semibold">
                                <span className="flex items-center gap-1 text-orange-400">
                                    <span className="size-2 rounded-full bg-orange-500" /> 无限画布
                                </span>
                                <span className="flex items-center gap-1 text-stone-500">
                                    <span className="size-2 rounded-full bg-stone-600" /> 传统SaaS
                                </span>
                            </div>
                        </div>

                        {/* SVG Radar */}
                        <div className="relative flex justify-center py-2">
                            <svg width={size} height={size} className="overflow-visible">
                                <defs>
                                    <radialGradient id="radarCompactGradient" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                                        <stop offset="100%" stopColor="#d97706" stopOpacity="0.08" />
                                    </radialGradient>
                                </defs>

                                {levels.map((lvl) => (
                                    <path
                                        key={lvl}
                                        d={metrics.map((_, i) => {
                                            const { x, y } = getCoordinates(i, lvl * 100);
                                            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                                        }).concat("Z").join(" ")}
                                        fill="none"
                                        stroke="#374151"
                                        strokeWidth="1"
                                        strokeDasharray={lvl === 1 ? "none" : "2 2"}
                                    />
                                ))}

                                {metrics.map((_, i) => {
                                    const { x, y } = getCoordinates(i, 100);
                                    return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="#374151" strokeWidth="1" />;
                                })}

                                <path
                                    d={getPolygonPath("traditionalSaaS")}
                                    fill="rgba(107, 114, 128, 0.12)"
                                    stroke="#6b7280"
                                    strokeWidth="1.2"
                                    strokeDasharray="3 3"
                                />

                                <path
                                    d={getPolygonPath("infiniteCanvas")}
                                    fill="url(#radarCompactGradient)"
                                    stroke="#f97316"
                                    strokeWidth="2"
                                />

                                {metrics.map((m, i) => {
                                    const coordPoint = getCoordinates(i, m.infiniteCanvas);
                                    const coordLabel = getCoordinates(i, 122);
                                    const isHovered = hoveredMetricIndex === i;

                                    return (
                                        <g
                                            key={i}
                                            className="cursor-pointer"
                                            onMouseEnter={() => setHoveredMetricIndex(i)}
                                            onMouseLeave={() => setHoveredMetricIndex(null)}
                                        >
                                            <circle
                                                cx={coordPoint.x}
                                                cy={coordPoint.y}
                                                r={isHovered ? "5" : "3.5"}
                                                fill="#f97316"
                                                stroke="#ffffff"
                                                strokeWidth="1.5"
                                            />
                                            <text
                                                x={coordLabel.x}
                                                y={coordLabel.y}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                                className={`text-[10px] ${isHovered ? "fill-orange-400 font-bold" : "fill-stone-300"}`}
                                            >
                                                {m.label}
                                            </text>
                                        </g>
                                    );
                                })}
                            </svg>
                        </div>

                        {/* Interactive Tooltip Chip */}
                        <div className="min-h-[2.5rem] rounded-xl border border-stone-800 bg-stone-950/80 px-3 py-2 text-[11px] text-stone-300">
                            {hoveredMetricIndex !== null ? (
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-orange-400">{metrics[hoveredMetricIndex].label}</span>
                                    <span className="text-stone-400 truncate">{metrics[hoveredMetricIndex].description}</span>
                                </div>
                            ) : (
                                <div className="text-center text-stone-500">悬停顶点查看指标解析</div>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Compact Feature Grid (7 cols) */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:col-span-7">
                        {metrics.map((item, idx) => (
                            <div
                                key={item.label}
                                onMouseEnter={() => setHoveredMetricIndex(idx)}
                                onMouseLeave={() => setHoveredMetricIndex(null)}
                                className={`rounded-xl border p-3.5 transition-all duration-200 ${
                                    hoveredMetricIndex === idx
                                        ? "border-orange-500/50 bg-stone-900 shadow-md"
                                        : "border-stone-800 bg-stone-900/60 hover:border-stone-700"
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-stone-100">{item.label}</span>
                                    <span className="text-[10px] font-extrabold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded">
                                        {item.infiniteCanvas}%
                                    </span>
                                </div>

                                <p className="mt-1 text-[11px] text-stone-400 line-clamp-1">{item.description}</p>

                                <div className="mt-2.5 relative h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
                                    <div
                                        style={{ width: `${item.infiniteCanvas}%` }}
                                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Compact Comparison Matrix Table below */}
                <div className="mt-6 overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/80 shadow-xl backdrop-blur-xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[580px]">
                            <thead className="border-b border-stone-800 bg-stone-950/80 text-[11px] uppercase tracking-wider text-stone-400">
                                <tr>
                                    <th className="px-4 py-3 font-bold">核心特性</th>
                                    <th className="px-4 py-3 font-bold text-orange-400 bg-orange-500/10">🔥 无限画布 (Infinite Canvas)</th>
                                    <th className="px-4 py-3 font-medium">传统 Web SaaS 工具</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-800/60 text-stone-300">
                                {comparisonRows.map((row) => {
                                    const Icon = row.icon;
                                    return (
                                        <tr key={row.feature} className="hover:bg-stone-800/30 transition-colors">
                                            <td className="px-4 py-3 font-semibold text-stone-200 flex items-center gap-2">
                                                <Icon className="size-3.5 text-orange-400 shrink-0" />
                                                <span>{row.feature}</span>
                                            </td>
                                            <td className="px-4 py-3 font-bold text-emerald-400 bg-orange-500/5">
                                                <div className="flex items-center gap-1.5">
                                                    <Check className="size-3.5 text-emerald-400 shrink-0" />
                                                    <span>{row.infiniteCanvas}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-stone-500">
                                                <div className="flex items-center gap-1.5">
                                                    <X className="size-3.5 text-red-500/60 shrink-0" />
                                                    <span>{row.traditionalSaaS}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}
