import { Star, Quote, MessageSquareQuote } from "lucide-react";
import { motion } from "motion/react";

interface Testimonial {
    name: string;
    role: string;
    avatar: string;
    rating: number;
    quote: string;
    tag: string;
}

const testimonials: Testimonial[] = [
    {
        name: "张天宇",
        role: "资深 AIGC 概念设计师",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "无限画布彻底改变了我的创作流程！连线拖拽和局部蒙版重绘体验无比流畅，多方案横向对比再也不用在几十个浏览器标签页里来回切换了。",
        tag: "视觉体验极佳",
    },
    {
        name: "Alex Chen",
        role: "独立全栈开发者",
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "作为开发者，结合本地 Agent MCP 协议后，AI 能直接在我的画布上生成并关联全部节点结构！真正的 AI Agent 操控体验，太惊艳了。",
        tag: "MCP 协议太强了",
    },
    {
        name: "李若涵",
        role: "UI/UX 团队负责人",
        avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "全量浏览器本地 IndexedDB 存储让我非常放心，API Key 密钥自持免除了隐私泄漏隐患。极简无界的设计语言，值得向全团队推荐！",
        tag: "100% 隐私安全",
    },
];

export function TestimonialsSection() {
    return (
        <section id="testimonials" className="relative bg-stone-950 py-24 text-stone-100 overflow-hidden">
            {/* Background Light Glow */}
            <div className="pointer-events-none absolute right-0 top-1/2 size-96 -translate-y-1/2 rounded-full bg-amber-500/10 blur-3xl" />

            <div className="mx-auto max-w-7xl px-6">
                {/* Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <MessageSquareQuote className="size-3.5" /> 真实创作者口碑
                    </div>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                        来自真实用户的 <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">评价与赞誉</span>
                    </h2>
                    <p className="mt-4 text-base text-stone-400 sm:text-lg">
                        深受全球上万创作者与开发者的青睐与信任。
                    </p>
                </div>

                {/* Cards Grid */}
                <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                    {testimonials.map((t, idx) => (
                        <motion.div
                            key={t.name}
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: idx * 0.15 }}
                            className="group relative flex flex-col justify-between rounded-3xl border border-stone-800 bg-stone-900/60 p-8 shadow-xl backdrop-blur-xl transition-all duration-300 hover:border-orange-500/50 hover:shadow-2xl hover:shadow-orange-500/10"
                        >
                            {/* Quote Icon */}
                            <Quote className="size-8 text-orange-500/20 group-hover:text-orange-500/40 transition-colors" />

                            <p className="mt-4 text-sm leading-relaxed text-stone-200">
                                "{t.quote}"
                            </p>

                            <div className="mt-8 pt-6 border-t border-stone-800 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <img
                                        src={t.avatar}
                                        alt={t.name}
                                        className="size-10 rounded-full border border-stone-700 object-cover shadow-md"
                                    />
                                    <div>
                                        <div className="text-sm font-bold text-stone-100">{t.name}</div>
                                        <div className="text-xs text-stone-400">{t.role}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 text-amber-400">
                                    {Array.from({ length: t.rating }).map((_, i) => (
                                        <Star key={i} className="size-3.5 fill-amber-400" />
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
