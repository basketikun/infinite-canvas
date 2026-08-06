import { useState } from "react";
import { ArrowRight, Sparkles, Zap, PlayCircle, ShieldCheck, Cpu, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";

export function HeroSection() {
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        setMousePos({ x, y });
    };

    return (
        <section
            onMouseMove={handleMouseMove}
            className="relative min-h-[90vh] overflow-hidden bg-stone-950 pt-28 pb-20 text-stone-100 flex items-center justify-center"
        >
            {/* Ambient Background Gradient Lights */}
            <div className="pointer-events-none absolute left-1/2 top-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-orange-500/20 via-amber-500/10 to-transparent blur-3xl" />
            <div className="pointer-events-none absolute -left-20 top-1/3 size-80 rounded-full bg-yellow-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 bottom-10 size-80 rounded-full bg-orange-600/10 blur-3xl" />

            {/* Grid Pattern overlay */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f293715_1px,transparent_1px),linear-gradient(to_bottom,#1f293715_1px,transparent_1px)] bg-[size:4rem_4rem]" />

            <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="grid items-center gap-10 lg:grid-cols-12">
                    {/* Left 6 Cols: Hero Text & Call to Actions */}
                    <div className="text-center lg:col-span-6 lg:text-left">
                        {/* Main Title */}
                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="mt-6 text-3xl font-black tracking-tight sm:text-5xl lg:text-6xl leading-[1.15]"
                        >
                            重构视觉灵感 <br className="hidden sm:inline" />
                            让 AIGC 创作在{" "}
                            <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
                                无限画布
                            </span>{" "}
                            自由流动
                        </motion.h1>

                        {/* Subtitle Description */}
                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className="mt-6 text-base text-stone-300 sm:text-lg leading-relaxed max-w-2xl mx-auto lg:mx-0"
                        >
                            融合多模态生图与视频、局部蒙版编辑、智能侧边助手与本地 IDE Agent (MCP) 协议。100% 浏览器本地存储，API 密钥完全自主把控。
                        </motion.p>

                        {/* Primary Action Buttons */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.3 }}
                            className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4"
                        >
                            <Link
                                to="/canvas"
                                className="group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-fuchsia-500 px-8 py-4 text-base font-extrabold text-white shadow-2xl shadow-pink-500/35 transition-all duration-300 hover:scale-105 hover:shadow-pink-500/60 hover:brightness-110 active:scale-95 w-full sm:w-auto"
                            >
                                <Zap className="size-5 fill-white" />
                                <span>立即免费体验</span>
                                <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
                            </Link>

                            <a
                                href="#features"
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-stone-800 bg-stone-900/80 px-7 py-4 text-base font-semibold text-stone-200 backdrop-blur-md transition-all duration-300 hover:border-pink-500/50 hover:bg-stone-800 hover:text-white w-full sm:w-auto"
                            >
                                <PlayCircle className="size-5 text-pink-400" />
                                <span>查看特色功能</span>
                            </a>
                        </motion.div>

                        {/* Feature Stats Badges */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5, delay: 0.4 }}
                            className="mt-10 pt-8 border-t border-stone-800/80 grid grid-cols-3 gap-4 text-center lg:text-left"
                        >
                            <div>
                                <div className="text-xl sm:text-2xl font-black text-orange-400">100%</div>
                                <div className="text-xs text-stone-400 mt-1">本地隐私闭环</div>
                            </div>
                            <div>
                                <div className="text-xl sm:text-2xl font-black text-amber-400">0 门槛</div>
                                <div className="text-xs text-stone-400 mt-1">直连 OpenAI API</div>
                            </div>
                            <div>
                                <div className="text-xl sm:text-2xl font-black text-yellow-400">MCP 原生</div>
                                <div className="text-xs text-stone-400 mt-1">本地 Agent 操控</div>
                            </div>
                        </motion.div>
                    </div>

                    {/* Right 6 Cols: 3D Tilt Interactive Mockup Card */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.7, delay: 0.2 }}
                        className="perspective-1000 lg:col-span-6 flex justify-center"
                    >
                        <motion.div
                            style={{
                                rotateY: mousePos.x * 20,
                                rotateX: -mousePos.y * 20,
                            }}
                            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-stone-800/90 bg-stone-900/80 p-3 shadow-2xl backdrop-blur-xl transition-transform duration-150 ease-out"
                        >
                            {/* Inner Header */}
                            <div className="flex items-center justify-between rounded-2xl bg-stone-950 px-4 py-3 border border-stone-800">
                                <div className="flex items-center gap-2">
                                    <span className="size-3 rounded-full bg-red-500" />
                                    <span className="size-3 rounded-full bg-yellow-500" />
                                    <span className="size-3 rounded-full bg-green-500" />
                                    <span className="ml-2 font-mono text-xs font-semibold text-stone-300">
                                        Infinite Canvas v0.13.0
                                    </span>
                                </div>
                                <span className="rounded-full bg-orange-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-orange-400">
                                    RUNNING
                                </span>
                            </div>

                            {/* Canvas Mockup Area */}
                            <div className="relative mt-3 h-80 w-full rounded-2xl border border-stone-800 bg-[radial-gradient(#374151_1px,transparent_1px)] [background-size:20px_20px] p-6 overflow-hidden">
                                {/* Floating Node 1: Prompt */}
                                <motion.div
                                    animate={{ y: [-4, 4, -4] }}
                                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute left-4 top-4 w-44 rounded-xl border border-orange-500/40 bg-stone-900/95 p-3 shadow-xl backdrop-blur-md"
                                >
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-orange-400">
                                        <Sparkles className="size-3" /> 提示词节点 #01
                                    </div>
                                    <p className="mt-1 text-[10px] text-stone-300 line-clamp-2">
                                        Cyberpunk futuristic metropolis, neon lights, 8k hyperrealistic...
                                    </p>
                                </motion.div>

                                {/* Floating Node 2: Image Render */}
                                <motion.div
                                    animate={{ y: [4, -4, 4] }}
                                    transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute right-4 bottom-4 w-52 rounded-xl border border-amber-500/40 bg-stone-900/95 p-3 shadow-xl backdrop-blur-md"
                                >
                                    <div className="flex items-center justify-between text-[11px] font-bold text-amber-400">
                                        <div className="flex items-center gap-1.5">
                                            <Layers className="size-3" /> 生图渲染结果
                                        </div>
                                        <span className="text-[9px] text-emerald-400">100%</span>
                                    </div>
                                    <div className="mt-2 h-20 w-full rounded-lg bg-gradient-to-tr from-orange-600 via-amber-600 to-amber-400 p-2 shadow-inner flex items-end">
                                        <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white backdrop-blur-sm">
                                            1024 x 1024
                                        </span>
                                    </div>
                                </motion.div>

                                {/* Connection Line Overlay */}
                                <svg className="absolute inset-0 h-full w-full pointer-events-none">
                                    <line
                                        x1="140"
                                        y1="60"
                                        x2="240"
                                        y2="190"
                                        stroke="#f97316"
                                        strokeWidth="2"
                                        strokeDasharray="4 4"
                                    />
                                </svg>

                                {/* Center Agent Pulse Indicator */}
                                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
                                    <div className="grid size-10 place-items-center rounded-full bg-orange-500/20 border border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.5)] animate-pulse">
                                        <Cpu className="size-5 text-orange-400" />
                                    </div>
                                    <span className="rounded bg-stone-950/80 px-2 py-0.5 text-[9px] font-mono text-orange-300 border border-stone-800">
                                        MCP ACTIVE
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
