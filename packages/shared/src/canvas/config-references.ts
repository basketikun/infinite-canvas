type ConfigToken = { type: "text"; value: string } | { type: "reference"; value: string; nodeId: string };

export function formatConfigReference(nodeId: string) {
    return "@[node:" + nodeId.replace(/[\\\]]/g, "\\$&") + "]";
}

export function parseComposerTokens(value: string): ConfigToken[] {
    const tokens: ConfigToken[] = [];
    let start = 0;
    for (const match of value.matchAll(/@\[node:((?:\\[\s\S]|[^\\\]])+)\]/g)) {
        const index = match.index!;
        if (index > start) tokens.push({ type: "text", value: value.slice(start, index) });
        tokens.push({ type: "reference", value: match[0], nodeId: match[1].replace(/\\([\\\]])/g, "$1") });
        start = index + match[0].length;
    }
    if (start < value.length) tokens.push({ type: "text", value: value.slice(start) });
    return tokens;
}
