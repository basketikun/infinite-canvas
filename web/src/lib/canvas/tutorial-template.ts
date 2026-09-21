import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasDirectionAxis, type CanvasNodeData } from "@/types/canvas";

const CARD_WIDTH = 280;
const CARD_HEIGHT = 280;
const BATCH_ID = "agent_harness_direction_batch";

type DirectionDefinition = {
    id: string;
    number: string;
    title: string;
    axis: CanvasDirectionAxis;
    question: string;
    core: string;
    includes: string[];
    excludes: string[];
    branches: string[];
    evidence: Array<{ title: string; url: string }>;
};

const directions: DirectionDefinition[] = [
    {
        id: "harness_components", number: "01", title: "Harness Components", axis: "what",
        question: "Harness 的哪些部分应该具有进化能力？",
        core: "从单组件优化走向多组件、结构化的 Harness evolution。",
        includes: ["Prompt", "Tools", "Skills", "Memory", "Middleware", "Workflow"],
        excludes: ["搜索算法", "进化时机", "效果归因"],
        branches: ["Prompt Evolution", "Tool Evolution", "Skill Evolution", "Memory Evolution", "Middleware / Runtime Evolution", "Workflow Evolution", "Sub-agent / Role Evolution", "Joint Multi-component Evolution"],
        evidence: [{ title: "Agentic Harness Engineering", url: "https://arxiv.org/abs/2604.25850" }],
    },
    {
        id: "evolution_mechanisms", number: "02", title: "Evolution Mechanisms", axis: "how",
        question: "Harness 如何搜索、产生、选择和提交一个更好的版本？",
        core: "研究如何探索 Harness configuration space，而不是限定某个被修改的组件。",
        includes: ["Search", "Reflection", "Meta-Agent", "RL", "Program Opt.", "Population"],
        excludes: ["组件范围", "反馈来源", "迁移边界"],
        branches: ["Search-based Evolution", "Reflection-based Evolution", "Meta-agent Editing", "Reward-driven Optimization", "Program Optimization", "Population-based Evolution", "Hybrid Evolution"],
        evidence: [{ title: "AFlow", url: "https://arxiv.org/abs/2410.10762" }, { title: "AgentSquare", url: "https://arxiv.org/abs/2410.06153" }],
    },
    {
        id: "experience_feedback", number: "03", title: "Experience & Feedback", axis: "signal",
        question: "Harness 应该从什么经验中知道哪里需要改变？",
        core: "把原始运行经验转化为可行动、可验证的 evolution signal。",
        includes: ["Reward", "Failure", "Trajectory", "Human", "Critique", "Tests"],
        excludes: ["修改机制", "部署阶段", "安全约束"],
        branches: ["Scalar Reward", "Benchmark Outcome", "Unit / Integration Tests", "Failure Trajectories", "Successful Trajectories", "Natural-language Critique", "Human / Preference Feedback", "Cross-agent Feedback"],
        evidence: [{ title: "Agentic Harness Engineering", url: "https://arxiv.org/abs/2604.25850" }],
    },
    {
        id: "continual_evolution", number: "04", title: "Continual & Temporal Evolution", axis: "when",
        question: "Harness 应该在训练前、任务之间、任务中还是长期部署中进化？",
        core: "区分 adaptation stage，研究一次性优化与持续自进化的不同约束。",
        includes: ["Offline", "Benchmark", "Inter-task", "Test-time", "Online", "Lifelong"],
        excludes: ["谁来修改", "修改什么", "如何归因"],
        branches: ["Offline Evolution", "Benchmark-time Evolution", "Inter-task Evolution", "Test-time Evolution", "Online Evolution", "Continual Evolution", "Lifelong Evolution"],
        evidence: [{ title: "A Survey of Self-Evolving Agents", url: "https://arxiv.org/abs/2507.21046" }],
    },
    {
        id: "evolution_actors", number: "05", title: "Evolution Actors", axis: "who",
        question: "Harness 的修改决策由谁产生并由谁提交？",
        core: "比较 self-editing、独立 Evolver、团队与 Human-in-the-loop 的责任边界。",
        includes: ["Self", "Evolver", "Critic", "Multi-Agent", "Human-AI", "Co-evolve"],
        excludes: ["反馈信号", "组件范围", "成本优化"],
        branches: ["Self-editing Agent", "Separate Evolver Agent", "Critic → Evolver", "Multi-agent Evolution Team", "Human-in-the-loop Evolution", "Population Evolution", "Agent–Environment Co-evolution"],
        evidence: [{ title: "A Self-Improving Coding Agent", url: "https://arxiv.org/abs/2504.15228" }],
    },
    {
        id: "evaluation_attribution", number: "06", title: "Evaluation & Attribution", axis: "evaluation",
        question: "如何判断一次 Harness 修改真的有效，并确定性能变化来自哪里？",
        core: "从结果评测走向 edit-level prediction、verification 与 causal attribution。",
        includes: ["Credit", "Causality", "Ablation", "Counterfactual", "Verify", "Interaction"],
        excludes: ["搜索预算", "安全回滚", "跨域迁移"],
        branches: ["Edit-level Attribution", "Component Credit Assignment", "Interaction Effects", "Ablation", "Counterfactual Evaluation", "Prediction → Verification", "Longitudinal Evaluation", "Causal Attribution"],
        evidence: [{ title: "Agentic Harness Engineering", url: "https://arxiv.org/abs/2604.25850" }, { title: "MIPRO", url: "https://arxiv.org/abs/2406.11695" }],
    },
    {
        id: "reliable_safe_evolution", number: "07", title: "Reliable & Safe Evolution", axis: "reliability",
        question: "Harness 如何持续改善，同时避免 regression、漂移和危险改变？",
        core: "Self-improvement 不等于 monotonic improvement；所有修改都需要约束、验证与恢复路径。",
        includes: ["Regression", "Rollback", "Overfit", "Shift", "Drift", "Safety"],
        excludes: ["一般性能归因", "成本控制", "泛化收益"],
        branches: ["Regression Detection", "Regression Prediction", "Safe Edit Validation", "Rollback", "Benchmark Overfitting", "Distribution Shift", "Constraint Preservation", "Capability Drift", "Security / Alignment"],
        evidence: [{ title: "Agentic Harness Engineering", url: "https://arxiv.org/abs/2604.25850" }],
    },
    {
        id: "transfer_generalization", number: "08", title: "Transfer & Generalization", axis: "transfer",
        question: "Harness 学到的改进是局部技巧，还是可迁移的 Agent engineering？",
        core: "确定 evolved Harness 在实例、任务、领域、benchmark 与模型之间的有效边界。",
        includes: ["Instance", "Task", "Domain", "Benchmark", "Model", "Universal"],
        excludes: ["演化成本", "修改主体", "在线时机"],
        branches: ["Cross-instance", "Cross-task", "Cross-benchmark", "Cross-domain", "Cross-model", "Cross-model-family", "Universal vs Specialized Harness"],
        evidence: [{ title: "Agentic Harness Engineering", url: "https://arxiv.org/abs/2604.25850" }],
    },
    {
        id: "efficient_evolution", number: "09", title: "Efficiency & Scalability", axis: "efficiency",
        question: "如何降低 Harness evolution 的搜索、推理和验证成本？",
        core: "在有限 budget 下选择最值得提出、运行与复用的 edit 和 evaluation。",
        includes: ["Budget", "Surrogate", "Predictor", "Early Stop", "Reuse", "Cost"],
        excludes: ["安全本身", "进化主体", "组件 taxonomy"],
        branches: ["Search-space Reduction", "Surrogate Evaluation", "Performance Prediction", "Targeted Evaluation", "Early Stopping", "Experience Reuse", "Edit Reuse", "Budget-aware Evolution", "Cost–Performance Optimization"],
        evidence: [{ title: "AgentSquare", url: "https://arxiv.org/abs/2410.06153" }, { title: "MIPRO", url: "https://arxiv.org/abs/2406.11695" }],
    },
];

function directionDocument(direction: DirectionDefinition) {
    const references = direction.evidence.map((item) => `- [${item.title}](${item.url})`).join("\n");
    return `# ${direction.number} · ${direction.title}\n\n> **L1 · Broad Direction** · Axis: \`${direction.axis.toUpperCase()}\`\n\n## Core Question\n\n${direction.question}\n\n## Research Core\n\n${direction.core}\n\n## Includes\n\n${direction.includes.map((item) => `- ${item}`).join("\n")}\n\n## Potential Sub-directions\n\n${direction.branches.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n\n## Excludes at this level\n\n${direction.excludes.map((item) => `- ${item}`).join("\n")}\n\n## Representative Work\n\n${references}\n\n## Next Step\n\n选择一个 L2 Sub-direction，检查与其他 L1 Direction 的重叠，再形成可回答的 L3 Research Question。\n`;
}

function directionNode(direction: DirectionDefinition, index: number): CanvasNodeData {
    return {
        id: `direction_${direction.id}`,
        type: CanvasNodeType.Direction,
        title: `${direction.number} · ${direction.title}`,
        position: { x: 80 + (index % 3) * 320, y: 100 + Math.floor(index / 3) * 320 },
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        metadata: {
            status: "success", groupId: BATCH_ID, summary: direction.question, document: directionDocument(direction),
            direction: {
                level: 1, axis: direction.axis, scope: "Broad Direction", includes: direction.includes, excludes: direction.excludes,
                subDirections: direction.branches, evidenceRefs: direction.evidence.map((item) => item.url), status: "candidate",
            },
        },
    };
}

function edge(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}--${toNodeId}`, fromNodeId, toNodeId };
}

export function createResearchTutorialProject(): Partial<CanvasProject> {
    const now = new Date().toISOString();
    const branchCount = directions.reduce((total, direction) => total + direction.branches.length, 0);
    const nodes: CanvasNodeData[] = [
        {
            id: BATCH_ID, type: CanvasNodeType.Group, title: `First Direction Map · 9 major directions · ${branchCount} branches`,
            position: { x: 20, y: 20 }, width: 1000, height: 1040,
            metadata: {
                status: "success",
                document: `# Research Direction Map\n\n围绕 **Agent Harness 自进化**，先建立 taxonomy-driven 的 L1 研究空间，而不是直接猜测几个论文题目。\n\n## Coverage axes\n\n1. WHAT — Harness Components\n2. HOW — Evolution Mechanisms\n3. SIGNAL — Experience & Feedback\n4. WHEN — Continual & Temporal Evolution\n5. WHO — Evolution Actors\n6. EVALUATE — Evaluation & Attribution\n7. RELIABILITY — Reliable & Safe Evolution\n8. TRANSFER — Transfer & Generalization\n9. EFFICIENCY — Efficiency & Scalability\n\n当前覆盖：**9 major directions · ${branchCount} potential branches**。这表示主要维度覆盖，不代表理论上穷尽全部研究方向。`,
            },
        },
        {
            id: "seed_agent_harness_evolution", type: CanvasNodeType.Seed, title: "Agent Harness 自进化",
            position: { x: -420, y: 360 }, width: 300, height: 320,
            metadata: {
                status: "success",
                summary: "研究 Agent Harness 如何从执行经验与反馈中持续改进自身。先铺开研究空间，再选择 L2 子方向形成 Research Question。",
                document: "# Agent Harness 自进化\n\n## Seed\n\n研究 Agent Harness 如何从执行经验与反馈中持续改进自身。\n\n## Formation rule\n\n```text\nL0 Seed\n  ↓\nL1 Direction — 宽泛研究空间\n  ↓\nL2 Sub-direction — 明确问题区域\n  ↓\nL3 Research Question — 可研究、可回答的问题\n```\n\n第一轮不是生成几个看起来像论文题目的点子，而是搜索代表性文献、建立 taxonomy、检查九个正交轴的覆盖，并形成 Direction Map。",
            },
        },
        {
            id: "tutorial_guide", type: CanvasNodeType.Note, title: "教程｜如何使用这张地图",
            position: { x: -420, y: 40 }, width: 300, height: 240,
            metadata: {
                status: "success",
                content: "1. 从 Seed 进入 First Direction Map。\n2. 九张卡都是 L1 宽泛方向，不是论文题目。\n3. 卡片只显示核心问题、coverage 与分支数。\n4. 选中节点，在悬浮工具栏打开 Markdown 文档。\n5. 从文档中的 L2 分支继续形成 L3 Research Question。",
                document: "# 教程：从 Seed 到 Direction Map\n\n- **浏览卡片**：快速比较九个研究轴。\n- **打开文档**：选中节点后点击工具栏的“文档”，查看和编辑完整 Markdown。\n- **继续探索**：选择一个 L2 Sub-direction，再生成具体 Research Question。\n- **保持层级**：Seed ≠ Direction ≠ Sub-direction ≠ Research Question。\n- **理解 coverage**：9/9 表示 taxonomy 的主要维度已经覆盖，不代表穷尽世界上所有方向。",
            },
        },
        ...directions.map(directionNode),
    ];

    return {
        title: "教程｜Agent Harness 自进化 Direction Map", createdAt: now, updatedAt: now, nodes,
        connections: [edge("seed_agent_harness_evolution", BATCH_ID)], chatSessions: [], activeChatId: null,
        backgroundMode: "dots", showImageInfo: false, viewport: { x: 520, y: 120, k: 0.62 },
    };
}
