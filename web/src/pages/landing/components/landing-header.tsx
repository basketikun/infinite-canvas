import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";

export function LandingHeader() {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 20) {
                setScrolled(true);
            } else {
                setScrolled(false);
            }
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const navLinks = [
        { href: "#features", label: "特色功能" },
        { href: "#personas", label: "用户画像" },
        { href: "#comparison", label: "竞品对比" },
        { href: "#testimonials", label: "创作者口碑" },
        { href: "#pricing", label: "会员计划" },
    ];

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
                scrolled
                    ? "bg-stone-950/90 backdrop-blur-xl border-b border-stone-800/80 py-3 shadow-xl"
                    : "bg-transparent py-5"
            }`}
        >
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
                {/* Top-Left Logo */}
                <Link to="/landing" className="flex items-center gap-2.5 group">
                    <div
                        className="size-7 shrink-0 bg-gradient-to-tr from-orange-400 to-amber-500 rounded-lg p-1 group-hover:scale-105 transition-transform"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                    />
                    <div className="flex flex-col">
                        <span className="text-lg font-black tracking-tight text-stone-100 group-hover:text-orange-400 transition-colors">
                            无限画布
                        </span>
                        <span className="text-[9px] font-mono text-stone-400 tracking-widest uppercase">
                            infinite-canvas
                        </span>
                    </div>
                </Link>

                {/* Desktop Navigation Links */}
                <nav className="hidden items-center gap-8 md:flex text-sm font-medium text-stone-300">
                    {navLinks.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="transition hover:text-orange-400"
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                {/* Top-Right Area */}
                <div className="flex items-center gap-4">
                    {/* Mobile Menu Trigger */}
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="grid size-9 place-items-center rounded-xl border border-stone-800 bg-stone-900 text-stone-300 md:hidden"
                        aria-label="Toggle menu"
                    >
                        {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile Dropdown Menu */}
            {mobileMenuOpen && (
                <div className="border-b border-stone-800 bg-stone-950/95 px-6 py-4 backdrop-blur-2xl md:hidden">
                    <nav className="flex flex-col gap-4 text-sm font-medium text-stone-300">
                        {navLinks.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="transition hover:text-orange-400 py-1"
                            >
                                {link.label}
                            </a>
                        ))}
                    </nav>
                </div>
            )}
        </header>
    );
}
