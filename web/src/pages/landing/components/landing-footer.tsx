import { Link } from "react-router-dom";
import { Code2, Globe, BookOpen, ShieldCheck, Heart } from "lucide-react";
import { DOCS_URL } from "@/constant/env";

export function LandingFooter() {
    return (
        <footer className="border-t border-stone-800 bg-stone-950 py-12 text-stone-400">
            <div className="mx-auto max-w-7xl px-6">
                <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Brand Col */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2.5">
                            <div
                                className="size-6 shrink-0 bg-orange-400"
                                style={{
                                    mask: "url(/logo.svg) center / contain no-repeat",
                                    WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                }}
                            />
                            <span className="text-lg font-bold text-stone-100">无限画布</span>
                        </div>
                        <p className="text-xs text-stone-400 leading-relaxed">
                            面向多模态 AI 创作的开源交互式无限画布工作台。纯前端本地安全，密钥自持。
                        </p>
                    </div>

                    {/* Quick Nav Col */}
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-200">快速导航</h4>
                        <ul className="mt-4 space-y-2 text-xs">
                            <li>
                                <Link to="/" className="hover:text-orange-400 transition-colors">
                                    进入项目首页 (Canvas)
                                </Link>
                            </li>
                            <li>
                                <a href="#features" className="hover:text-orange-400 transition-colors">
                                    特色功能
                                </a>
                            </li>
                            <li>
                                <a href="#comparison" className="hover:text-orange-400 transition-colors">
                                    竞品分析与雷达图
                                </a>
                            </li>
                            <li>
                                <a href="#pricing" className="hover:text-orange-400 transition-colors">
                                    会员订阅计划
                                </a>
                            </li>
                        </ul>
                    </div>

                    {/* Resources Col */}
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-200">开源与生态</h4>
                        <ul className="mt-4 space-y-2 text-xs">
                            <li>
                                <a
                                    href="https://github.com/basketikun/infinite-canvas"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 hover:text-orange-400 transition-colors"
                                >
                                    <Code2 className="size-3.5 text-orange-400" /> GitHub 开源仓库
                                </a>
                            </li>
                            <li>
                                <a
                                    href={DOCS_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 hover:text-orange-400 transition-colors"
                                >
                                    <BookOpen className="size-3.5" /> 官方操作手册
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://linux.do/"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1.5 hover:text-orange-400 transition-colors"
                                >
                                    <Globe className="size-3.5 text-blue-400" /> Linux.do 社区讨论
                                </a>
                            </li>
                        </ul>
                    </div>

                    {/* Privacy Col */}
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-200">安全与承诺</h4>
                        <div className="mt-4 space-y-2 text-xs text-stone-400">
                            <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                                <ShieldCheck className="size-4" /> 100% 浏览器本地存储
                            </div>
                            <p className="text-[11px] text-stone-500 leading-normal">
                                所有 API 密钥与画布数据默认全量存储于本地 IndexedDB，数据零云端归集。
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-12 border-t border-stone-900 pt-6 text-center text-xs text-stone-600 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>© {new Date().getFullYear()} Infinite Canvas. Open Source AGPL-3.0 License.</div>
                    <div className="flex items-center gap-1 text-stone-500">
                        Made with <Heart className="size-3 text-red-500 fill-red-500" /> for AI Creators.
                    </div>
                </div>
            </div>
        </footer>
    );
}
