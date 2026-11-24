import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const agents = ["claude-color", "codex-color", "cursor", "gemini-color", "cline", "opencode"];
const BEAM = 60;

type Line = { d: string; from: number; to: number };

function Node({ ref, className = "size-12", children }: { ref: (element: HTMLDivElement | null) => void; className?: string; children: React.ReactNode }) {
    return <div ref={ref} className={`z-10 flex items-center justify-center rounded-full bg-white shadow-md ${className}`}>{children}</div>;
}

/** 左右六个 Agent 通过流动光束连接到中间的画布。 */
export function AgentBeam() {
    const box = useRef<HTMLDivElement>(null);
    const nodes = useRef<(HTMLDivElement | null)[]>([]);
    const [lines, setLines] = useState<Line[]>([]);
    useLayoutEffect(() => {
        const measure = () => {
            const base = box.current!.getBoundingClientRect();
            const center = (element: HTMLDivElement) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.left - base.left + rect.width / 2, y: rect.top - base.top + rect.height / 2 };
            };
            const end = center(nodes.current[agents.length]!);
            setLines(agents.map((_, index) => {
                const start = center(nodes.current[index]!);
                return { d: `M ${start.x},${start.y} Q ${(start.x + end.x) / 2},${end.y} ${end.x},${end.y}`, from: start.x, to: end.x };
            }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(box.current!);
        return () => observer.disconnect();
    }, []);
    const icon = (name: string, index: number) => <Node key={name} ref={(element) => { nodes.current[index] = element; }}><img src={`/agents/${name}.svg`} alt="" className="size-6" draggable={false} /></Node>;
    return (
        <div ref={box} className="relative mx-auto flex w-full max-w-sm items-center justify-between px-1 py-2" aria-hidden="true">
            <svg className="pointer-events-none absolute inset-0 size-full">
                {lines.map((line, index) => {
                    const dir = Math.sign(line.to - line.from);
                    return <g key={index}>
                        <path d={line.d} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={2} strokeLinecap="round" />
                        <path d={line.d} fill="none" stroke={`url(#agent-beam-${index})`} strokeWidth={2} strokeLinecap="round" />
                        <defs>
                            <motion.linearGradient id={`agent-beam-${index}`} gradientUnits="userSpaceOnUse" initial={{ x1: line.from - dir * BEAM, x2: line.from }} animate={{ x1: [line.from - dir * BEAM, line.to], x2: [line.from, line.to + dir * BEAM] }} transition={{ duration: 3, delay: index * 0.4, repeat: Infinity, ease: [0.16, 1, 0.3, 1] }}>
                                <stop stopColor="#9c40ff" stopOpacity="0" />
                                <stop stopColor="#9c40ff" />
                                <stop offset="32.5%" stopColor="#ffaa40" />
                                <stop offset="100%" stopColor="#ffaa40" stopOpacity="0" />
                            </motion.linearGradient>
                        </defs>
                    </g>;
                })}
            </svg>
            <div className="flex flex-col gap-5">{agents.slice(0, 3).map((name, index) => icon(name, index))}</div>
            <Node className="size-16" ref={(element) => { nodes.current[agents.length] = element; }}><span className="size-9 bg-black" style={{ mask: "url(/logo.svg) center / contain no-repeat" }} /></Node>
            <div className="flex flex-col gap-5">{agents.slice(3).map((name, index) => icon(name, index + 3))}</div>
        </div>
    );
}
