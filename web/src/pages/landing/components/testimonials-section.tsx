import { Star, Quote, Heart } from "lucide-react";

interface Testimonial {
    id: string;
    name: string;
    role: string;
    avatar: string;
    rating: number;
    quote: string;
    tags: string[];
    duration: string;
}

// Row 1: Scrolling LEFT
const row1Testimonials: Testimonial[] = [
    {
        id: "t1",
        name: "王小红",
        role: "产品经理",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "界面设计非常精美，无限画布的节点拖拽与连线功能让团队的工作流清晰直观，已经推荐给整个团队！",
        tags: ["UI设计", "主题系统", "无界画布"],
        duration: "使用3个月",
    },
    {
        id: "t2",
        name: "张伟",
        role: "独立开发者",
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "一个平台整合了生图、视频、音频和提示词整理所有需求，结合本地 Agent MCP 接入，再也不用切多个应用了。",
        tags: ["MCP Agent", "全能工具", "All in AI"],
        duration: "使用1年",
    },
    {
        id: "t3",
        name: "刘芳",
        role: "UI设计师",
        avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "局部蒙版重绘与参考图生成功能很赞，把之前的修改成本降低了大半，看到画布上的标记很有成就感！",
        tags: ["蒙版重绘", "多模态生图", "视觉优化"],
        duration: "使用4个月",
    },
    {
        id: "t4",
        name: "李明",
        role: "前端工程师",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "纯前端架构 + 100% 浏览器本地 IndexedDB 存储太香了，API Key 放在本地非常安全，学习与使用动力十足。",
        tags: ["本地存储", "密钥安全", "学习管理"],
        duration: "使用6个月",
    },
    {
        id: "t5",
        name: "陈杰",
        role: "全栈开发者",
        avatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "代码完全开源，技术栈极其现代，作为学习参考也非常有价值。极其期待未来引入更多节点功能！",
        tags: ["开源", "现代技术栈", "极速构架"],
        duration: "使用7个月",
    },
    {
        id: "t6",
        name: "陆洋",
        role: "视觉总监",
        avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "无界无限扩展视图，对于大项目宏观把控和细节调整极有帮助，体验远超预期。",
        tags: ["宏观把控", "高保真", "无限视图"],
        duration: "使用5个月",
    },
];

// Row 2: Scrolling RIGHT
const row2Testimonials: Testimonial[] = [
    {
        id: "t7",
        name: "赵静",
        role: "AIGC概念艺术家",
        avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "提示词灵感库与侧边助手功能太甜了！和团队一起记录与推演画风灵感，超有意义。",
        tags: ["灵感库", "多方案对比", "创作协同"],
        duration: "使用2个月",
    },
    {
        id: "t8",
        name: "孙涛",
        role: "后端工程师",
        avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "响应速度很快，画布卡片拖拽与动画效果无比流畅，整体体验比很多商业云端 SaaS 产品都要好。",
        tags: ["性能", "动效", "高流畅度"],
        duration: "使用5个月",
    },
    {
        id: "t9",
        name: "周白",
        role: "数字艺术创作者",
        avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "可以在同一个无限画布上同时对比多种 API 生成的结果，自由度极高，社区生态也非常活跃！",
        tags: ["多模型对比", "无限拓扑", "社区原力"],
        duration: "使用3个月",
    },
    {
        id: "t10",
        name: "林悦",
        role: "动画导演",
        avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "视频生成与音频成曲节点无缝连接，直接组成了我的分镜工作流，大幅缩短了前期 Demo 的制作周期。",
        tags: ["视频生成", "分镜工作流", "音频连线"],
        duration: "使用8个月",
    },
    {
        id: "t11",
        name: "郭宇",
        role: "AI研究员",
        avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "支持自由挂载 OpenAI 兼容 API 与本地 Ollama 自建模型，数据隐私 100% 掌握在自己手中。",
        tags: ["自定义API", "本地模型", "隐私安全"],
        duration: "使用10个月",
    },
    {
        id: "t12",
        name: "邓峰",
        role: "独立全栈",
        avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80",
        rating: 5,
        quote: "结合 MCP Agent 本地自动化连线，真正体会到了 AI 操控画布的超级便利。",
        tags: ["MCP协议", "自动化", "画布操控"],
        duration: "使用9个月",
    },
];

export function TestimonialsSection() {
    const row1List = [...row1Testimonials, ...row1Testimonials];
    const row2List = [...row2Testimonials, ...row2Testimonials];

    return (
        <section id="testimonials" className="relative bg-stone-950 py-20 text-stone-100 sm:py-28 overflow-hidden border-t border-stone-800/80">
            {/* Ambient Background Glows */}
            <div className="pointer-events-none absolute left-1/2 top-10 h-[450px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-orange-500/10 via-amber-500/5 to-transparent blur-3xl" />
            <div className="pointer-events-none absolute -left-20 bottom-10 size-80 rounded-full bg-amber-500/10 blur-3xl" />

            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Header matching exact requested text */}
                <div className="mx-auto max-w-3xl text-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-orange-400 backdrop-blur-md">
                        <Heart className="size-3.5 fill-orange-400 text-orange-400" />
                        <span>用户评价</span>
                    </div>

                    <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
                        听听他们怎么说
                    </h2>

                    <p className="mt-3 text-sm text-stone-400 sm:text-base">
                        来自真实用户的反馈，是我们不断前进的动力
                    </p>
                </div>
            </div>

            {/* 2-Row Alternating Marquee Carousel */}
            <div className="relative mt-14 space-y-6 overflow-hidden py-2">
                {/* Side Fade Masks */}
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-20 w-16 bg-gradient-to-r from-stone-950 to-transparent sm:w-32" />
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-20 w-16 bg-gradient-to-l from-stone-950 to-transparent sm:w-32" />

                {/* ROW 1: Scrolling LEFT */}
                <div className="flex w-full overflow-hidden">
                    <div className="animate-marquee-left flex gap-6 px-3">
                        {row1List.map((item, idx) => (
                            <TestimonialCard key={`row1-${item.id}-${idx}`} item={item} />
                        ))}
                    </div>
                </div>

                {/* ROW 2: Scrolling RIGHT */}
                <div className="flex w-full overflow-hidden">
                    <div className="animate-marquee-right flex gap-6 px-3">
                        {row2List.map((item, idx) => (
                            <TestimonialCard key={`row2-${item.id}-${idx}`} item={item} />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function TestimonialCard({ item }: { item: Testimonial }) {
    return (
        <div className="group relative flex w-[310px] sm:w-[370px] shrink-0 flex-col justify-between rounded-2xl border border-stone-800 bg-stone-900/80 p-5 shadow-xl backdrop-blur-xl transition-all duration-300 hover:border-orange-500/50 hover:bg-stone-900 hover:shadow-2xl hover:shadow-orange-500/10">
            <div>
                {/* Card Top: Avatar, Name, Title on left; Stars on right */}
                <div className="flex items-center justify-between border-b border-stone-800/80 pb-3.5">
                    <div className="flex items-center gap-3">
                        <img
                            src={item.avatar}
                            alt={item.name}
                            className="size-10 rounded-full border border-stone-700 object-cover shadow-md group-hover:border-orange-400/60 transition-colors"
                        />
                        <div>
                            <div className="text-xs sm:text-sm font-bold text-stone-100 group-hover:text-orange-300 transition-colors">
                                {item.name}
                            </div>
                            <div className="text-[11px] text-stone-400 mt-0.5">{item.role}</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: item.rating }).map((_, i) => (
                            <Star key={i} className="size-3.5 fill-amber-400 text-amber-400" />
                        ))}
                    </div>
                </div>

                {/* Card Quote */}
                <div className="relative mt-3.5">
                    <Quote className="absolute -top-1 -left-1 size-4 text-orange-500/20 group-hover:text-orange-500/40 transition-colors" />
                    <p className="pl-3.5 text-xs sm:text-sm leading-relaxed text-stone-300">
                        {item.quote}
                    </p>
                </div>
            </div>

            {/* Card Footer: Tags on left, Usage duration on right */}
            <div className="mt-5 flex items-center justify-between border-t border-stone-800/80 pt-3.5 text-xs">
                <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((tag) => (
                        <span
                            key={tag}
                            className="rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-0.5 text-[10px] font-medium text-stone-300 group-hover:border-orange-500/30 group-hover:bg-orange-500/10 group-hover:text-orange-300 transition-colors"
                        >
                            {tag}
                        </span>
                    ))}
                </div>

                <span className="shrink-0 text-[10px] font-medium text-stone-400">
                    {item.duration}
                </span>
            </div>
        </div>
    );
}
