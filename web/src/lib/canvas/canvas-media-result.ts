type CanvasNodeRect = {
    id: string;
    position: { x: number; y: number };
    width: number;
    height: number;
};

export function findCanvasMediaResultPosition(source: CanvasNodeRect, resultSize: { width: number; height: number }, nodes: CanvasNodeRect[], gap = 96, verticalGap = 24) {
    const x = source.position.x + source.width + gap;
    let y = source.position.y + source.height / 2 - resultSize.height / 2;
    while (nodes.some((node) => node.id !== source.id && x < node.position.x + node.width && x + resultSize.width > node.position.x && y < node.position.y + node.height && y + resultSize.height > node.position.y)) {
        y += resultSize.height + verticalGap;
    }
    return { x, y };
}
