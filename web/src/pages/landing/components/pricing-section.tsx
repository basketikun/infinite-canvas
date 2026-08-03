import { useState } from "react";
import { Check, Crown, Zap, Shield, ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";

export function PricingSection() {
    const [isAnnual, setIsAnnual] = useState(true);

    return (
        <section id="pricing" className="relative bg-stone-900/80 py-24 text-stone-100 border-t border-stone-800">
            {/* Ambient Lighting */}
            <div className="pointer-events-none absolute left-1/2 bottom-0 h-96 w-full -translate-x-1/2 bg-gradient-to-t from-orange-500/10 via-transparent to-transparent blur-3xl" />

            <div className="mx-auto max-w-7xl px-6">
                {/* Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <Crown className="size-3.5" /> 灵活的会员计划
                    </div>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        选择适合你的 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">创作方案</span>
                    </h2>
                    <p className="mt-4 text-base text-stone-400 sm:text-lg">
                        开源免费离线即用，亦可升级享受云端同步与专属 Agent 算力通道。
                    </p>

                    {/* Annual / Monthly Billing Switcher */}
                    <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-stone-800 bg-stone-950 p-1.5 backdrop-blur-md">
                        <button
                            type="button"
                            onClick={() => setIsAnnual(false)}
                            className={`rounded-full px-5 py-2 text-xs font-bold transition-all ${
                                !isAnnual ? "bg-orange-500 text-stone-950 shadow-md" : "text-stone-400 hover:text-stone-200"
                            }`}
                        >
                            月付计划
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsAnnual(true)}
                            className={`flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold transition-all ${
                                isAnnual ? "bg-orange-500 text-stone-950 shadow-md" : "text-stone-400 hover:text-stone-200"
                            }`}
                        >
                            <span>年付计划</span>
                            <span className="rounded-full bg-stone-950/80 px-2 py-0.5 text-[10px] text-amber-300 font-extrabold">
                                省 20%
                            </span>
                        </button>
                    </div>
                </div>

                {/* Pricing Cards Grid */}
                <div className="mt-16 grid items-stretch gap-8 lg:grid-cols-3">
                    {/* Card 1: Free Community */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="flex flex-col justify-between rounded-3xl border border-stone-800 bg-stone-950/80 p-8 shadow-xl backdrop-blur-xl"
                    >
                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-stone-200">开源社区版</span>
                                <span className="rounded-full bg-stone-800 px-3 py-1 text-xs font-semibold text-stone-400">
                                    永久免费
                                </span>
                            </div>
                            <div className="mt-6 flex items-baseline gap-1">
                                <span className="text-4xl font-black text-stone-100">¥0</span>
                                <span className="text-xs text-stone-400">/ 永久</span>
                            </div>
                            <p className="mt-3 text-xs text-stone-400">零开销体验完整无限画布功能与本地 Agent 联动。</p>

                            <ul className="mt-8 space-y-4 text-xs text-stone-300">
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>无限画布布局、拖拽连线与小地图</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>100% 浏览器本地 IndexedDB 存储</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>自持直连任意 OpenAI 兼容 API</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>支持 Codex / Claude Code 本地 MCP Agent</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>提示词灵感库与本地资产沉淀</span>
                                </li>
                            </ul>
                        </div>

                        <Link
                            to="/canvas"
                            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-700 bg-stone-900 py-3.5 text-xs font-bold text-stone-200 transition hover:border-orange-500 hover:bg-stone-800 hover:text-white"
                        >
                            <span>免费开始使用</span>
                            <ArrowRight className="size-4" />
                        </Link>
                    </motion.div>

                    {/* Card 2: Pro (Featured Card) */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15 }}
                        className="relative flex flex-col justify-between rounded-3xl border-2 border-orange-500 bg-gradient-to-b from-orange-950/40 via-stone-950 to-stone-950 p-8 shadow-2xl shadow-orange-500/10 backdrop-blur-xl"
                    >
                        {/* Featured Highlight Badge */}
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-1 text-xs font-extrabold text-stone-950 shadow-lg">
                            🔥 最受创作者欢迎
                        </div>

                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-orange-300">专业创作者版</span>
                                <span className="rounded-full bg-orange-500/20 px-3 py-1 text-xs font-bold text-orange-400">
                                    PRO
                                </span>
                            </div>
                            <div className="mt-6 flex items-baseline gap-1">
                                <span className="text-5xl font-black text-orange-400">
                                    ¥{isAnnual ? "31" : "39"}
                                </span>
                                <span className="text-xs text-stone-400">/ 月 {isAnnual ? "(年付)" : "(月付)"}</span>
                            </div>
                            <p className="mt-3 text-xs text-stone-300">为专业设计师与创作者打造的全能增强套餐。</p>

                            <ul className="mt-8 space-y-4 text-xs text-stone-200">
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span className="font-bold text-stone-100">包含社区版全部功能</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>在线高级节点插件库无限安装</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>云端加密同步与多设备画布云备份</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>高清大图 4K 局部重绘渲染加速</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>专属 7x24 优先技术客服解答</span>
                                </li>
                            </ul>
                        </div>

                        <Link
                            to="/canvas"
                            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 py-4 text-xs font-extrabold text-stone-950 shadow-lg shadow-orange-500/25 transition hover:scale-105 hover:shadow-orange-500/40"
                        >
                            <Zap className="size-4" />
                            <span>立即解锁 Pro 权限</span>
                        </Link>
                    </motion.div>

                    {/* Card 3: Enterprise */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="flex flex-col justify-between rounded-3xl border border-stone-800 bg-stone-950/80 p-8 shadow-xl backdrop-blur-xl"
                    >
                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-stone-200">企业与团队版</span>
                                <span className="rounded-full bg-stone-800 px-3 py-1 text-xs font-semibold text-stone-400">
                                    团队定制
                                </span>
                            </div>
                            <div className="mt-6 flex items-baseline gap-1">
                                <span className="text-4xl font-black text-stone-100">
                                    ¥{isAnnual ? "159" : "199"}
                                </span>
                                <span className="text-xs text-stone-400">/ 席位 / 月</span>
                            </div>
                            <p className="mt-3 text-xs text-stone-400">针对企业团队私有部署与多人协作需求定制。</p>

                            <ul className="mt-8 space-y-4 text-xs text-stone-300">
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span className="font-bold text-stone-100">包含 Pro 版全部功能</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>私有 Docker / Nginx 快速部署支持</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>团队多人实时共享与协同画布编辑</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>企业级统一 API 网关与密钥权限分配</span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <Check className="size-4 text-orange-400 shrink-0" />
                                    <span>专属定制 Client Agent 挂载管道</span>
                                </li>
                            </ul>
                        </div>

                        <button
                            type="button"
                            onClick={() => window.location.href = "mailto:support@infinite-canvas.org"}
                            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-700 bg-stone-900 py-3.5 text-xs font-bold text-stone-200 transition hover:border-orange-500 hover:bg-stone-800 hover:text-white"
                        >
                            <span>联系企业顾问</span>
                            <ArrowRight className="size-4" />
                        </button>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
