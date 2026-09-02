import type { H3Ref } from "../types";
export function RefsTimeline({ refs }: { refs: H3Ref[] }) { return <div className="minimax-ref-content">{refs.map((ref) => <div className="minimax-ref-clip has-ref" key={ref.url}><span>{ref.name}</span></div>)}</div>; }
