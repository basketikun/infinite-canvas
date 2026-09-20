import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const CARD_WIDTH = 280;
const CARD_HEIGHT = 320;

function researchNode(id: string, type: CanvasNodeType, title: string, summary: string, x: number, y: number): CanvasNodeData {
    return {
        id,
        type,
        title,
        position: { x, y },
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        metadata: { status: "success", summary },
    };
}

function sourceNode(id: string, title: string, sourceUrl: string, x: number, y: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Web,
        title,
        position: { x, y },
        width: 300,
        height: 180,
        metadata: { status: "success", sourceUrl },
    };
}

function edge(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}--${toNodeId}`, fromNodeId, toNodeId };
}

export function createResearchTutorialProject(): Partial<CanvasProject> {
    const now = new Date().toISOString();
    const nodes: CanvasNodeData[] = [
        {
            id: "tutorial-guide",
            type: CanvasNodeType.Note,
            title: "教程｜从 Seed 到 Idea",
            position: { x: -460, y: -520 },
            width: 340,
            height: 230,
            metadata: {
                status: "success",
                content: "从中央 Seed 开始，向右阅读已选择的研究形成链。\n\n上下分支是 Agent 提出的备选方向；下方网页节点是 Evidence Resource，不属于九种 Research Reasoning Nodes。\n\n你可以修改任意节点，或让 Agent 基于当前节点继续探索。",
            },
        },
        researchNode("seed_ai_research_training", CanvasNodeType.Seed, "AI 时代的研究训练", "AI 能让学生更快搜索、总结和写作，但它究竟是在帮助学生形成研究能力，还是在替学生完成原本应该由学生完成的判断？", -140, -160),

        researchNode("dir_ai_literacy", CanvasNodeType.Direction, "AI Literacy Training · Alternative", "研究大学教育应该培养什么样的 AI 使用能力，使学生能够理解、评估和负责任地使用 AI。", 300, -600),
        researchNode("dir_research_judgment", CanvasNodeType.Direction, "AI × Research Judgment · Selected", "研究 AI 如何改变学生判断论文价值、证据质量、研究空白和问题值得研究程度的能力。", 300, -160),
        researchNode("dir_ai_writing", CanvasNodeType.Direction, "AI × Academic Writing · Alternative", "研究 GenAI 如何改变学生从构思、组织论证到撰写学术文本的过程。", 300, 280),
        researchNode("dir_learning_outcomes", CanvasNodeType.Direction, "AI × Learning Outcomes · Alternative", "研究 GenAI 交互质量与输出质量如何影响学习结果。", 300, 720),

        researchNode("rq_relevance_credibility", CanvasNodeType.ResearchQuestion, "Evidence Relevance · Candidate", "AI 辅助文献探索如何影响新手研究者判断学术证据相关性与可信度的能力？", 740, -600),
        researchNode("rq_judgment_support", CanvasNodeType.ResearchQuestion, "Supporting Research Judgment · Selected", "AI 辅助研究工具应如何支持新手研究者形成 research judgment，而不是替代这种判断？", 740, -160),
        researchNode("rq_gap_identification", CanvasNodeType.ResearchQuestion, "Gap Identification · Merged", "对生成式 AI 的依赖如何影响学生识别有意义研究空白的能力？", 740, 280),

        researchNode("problem_answer_first_ai", CanvasNodeType.Problem, "Answer-first AI may bypass judgment", "现有 AI 研究助手主要优化搜索、总结和答案生成，却可能绕过证据比较、可信度判断、冲突识别与研究问题形成过程。", 1180, -160),

        researchNode("hyp_evidence_first", CanvasNodeType.Hypothesis, "Evidence-first Interaction · Selected", "如果 AI 先要求研究者比较证据、表达判断并说明理由，再提供支持，新手研究者将表现出更高的判断质量、校准能力和无 AI 迁移表现。", 1620, -160),
        researchNode("hyp_efficiency_only", CanvasNodeType.Hypothesis, "Efficiency-first Interaction · Alternative", "如果研究工具只提高搜索与综合效率，任务完成时间会降低，但研究判断能力未必同步提高。", 1620, 280),

        researchNode("approach_contrastive_workspace", CanvasNodeType.Approach, "Contrastive Human–AI Workspace", "构建功能能力相近但交互哲学不同的 Answer-first 与 Evidence-first AI research interfaces，比较两种支持方式如何影响研究判断形成。", 2060, -160),
        researchNode("method_mixed_study", CanvasNodeType.Method, "Controlled Study + Process Analysis", "招募 48 名研究经验较少的高年级本科生与硕士一年级学生，开展组间对照实验；收集画布日志、论文选择、信心评分、任务结果、访谈与无 AI transfer task。", 2500, -160),
        researchNode("evaluation_judgment", CanvasNodeType.Evaluation, "Research Judgment Evaluation", "从 Judgment Quality、Confidence Calibration、Process 和 Unaided Transfer 四层评估；主要指标包括证据选择准确率、可信度判断、校准误差与迁移表现。", 2940, -160),
        researchNode("idea_judgment_scaffold", CanvasNodeType.Idea, "Judgment Scaffold", "一种 Evidence-first AI Workspace：AI 不直接替研究者完成综合与问题生成，而是在证据比较、可信度判断、矛盾识别和问题形成等关键节点提供结构化支持。", 3380, -160),

        sourceNode("evidence_chi_critical_thinking", "Evidence｜CHI 2025 Critical Thinking", "https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/", 1120, 360),
        sourceNode("evidence_unesco_guidance", "Evidence｜UNESCO Human-centred GenAI", "https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research", 1460, 580),
        sourceNode("evidence_unesco_competency", "Evidence｜UNESCO AI Competency", "https://www.unesco.org/en/articles/ai-competency-framework-students", 1120, 800),
    ];

    const connections: CanvasConnection[] = [
        edge("seed_ai_research_training", "dir_ai_literacy"),
        edge("seed_ai_research_training", "dir_research_judgment"),
        edge("seed_ai_research_training", "dir_ai_writing"),
        edge("seed_ai_research_training", "dir_learning_outcomes"),
        edge("dir_research_judgment", "rq_relevance_credibility"),
        edge("dir_research_judgment", "rq_judgment_support"),
        edge("dir_research_judgment", "rq_gap_identification"),
        edge("rq_judgment_support", "problem_answer_first_ai"),
        edge("problem_answer_first_ai", "hyp_evidence_first"),
        edge("problem_answer_first_ai", "hyp_efficiency_only"),
        edge("hyp_evidence_first", "approach_contrastive_workspace"),
        edge("approach_contrastive_workspace", "method_mixed_study"),
        edge("method_mixed_study", "evaluation_judgment"),
        edge("evaluation_judgment", "idea_judgment_scaffold"),
        edge("evidence_chi_critical_thinking", "problem_answer_first_ai"),
        edge("evidence_unesco_guidance", "problem_answer_first_ai"),
        edge("evidence_unesco_competency", "hyp_evidence_first"),
    ];

    return {
        title: "教程｜AI 时代的大学生研究训练",
        createdAt: now,
        updatedAt: now,
        nodes,
        connections,
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 520, y: 430, k: 0.32 },
    };
}
