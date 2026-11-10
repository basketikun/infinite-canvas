import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasNodeRow = { node: CanvasNodeData; depth: number; hasChildren: boolean };

export function buildCanvasNodeRows(options: {
    nodes: readonly CanvasNodeData[];
    filtered: readonly CanvasNodeData[];
    collapsedGroups: ReadonlySet<string>;
}): CanvasNodeRow[] {
    const { nodes, filtered, collapsedGroups } = options;
    const filteredIds = new Set(filtered.map((node) => node.id));
    const groups = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
    const children = new Map<string, CanvasNodeData[]>();
    for (const node of filtered) {
        const groupId = node.metadata?.groupId;
        if (!groupId || !groups.has(groupId)) continue;
        const bucket = children.get(groupId);
        if (bucket) bucket.push(node);
        else children.set(groupId, [node]);
    }
    const rows: CanvasNodeRow[] = [];
    for (const node of nodes) {
        if (node.metadata?.groupId && groups.has(node.metadata.groupId)) continue;
        const members = children.get(node.id);
        if (!filteredIds.has(node.id) && !members?.length) continue;
        rows.push({ node, depth: 0, hasChildren: Boolean(members?.length) });
        if (!members || collapsedGroups.has(node.id)) continue;
        for (const child of members) rows.push({ node: child, depth: 1, hasChildren: false });
    }
    return rows;
}

export function chunkCanvasNodeRows(rows: readonly CanvasNodeRow[], columns: number): CanvasNodeRow[][] {
    if (!Number.isInteger(columns) || columns < 1) throw new Error("Canvas node columns must be a positive integer");
    const result: CanvasNodeRow[][] = [];
    for (let index = 0; index < rows.length; index += columns) result.push(rows.slice(index, index + columns));
    return result;
}
