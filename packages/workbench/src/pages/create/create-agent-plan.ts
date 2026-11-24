export type PlanStep = { title: string; status: "pending" | "in_progress" | "completed" };

export function readPlanSteps(input: unknown): PlanStep[] {
    if (!input || typeof input !== "object" || !("steps" in input)) return [];
    const steps = (input as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) return [];
    return steps.flatMap((step) => {
        if (!step || typeof step !== "object") return [];
        const { title, status } = step as { title?: unknown; status?: unknown };
        if (typeof title !== "string" || !title.trim()) return [];
        return [{ title: title.trim(), status: status === "completed" ? "completed" as const : status === "in_progress" ? "in_progress" as const : "pending" as const }];
    });
}
