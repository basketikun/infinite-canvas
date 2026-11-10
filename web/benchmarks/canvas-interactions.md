# Canvas interaction measurements

## Scope and method

These measurements use Edge with Vite development mode, a 1912 × 909 viewport,
and an isolated local copy of a 4539-node / 4536-edge canvas. The canvas contains
28 groups with 161 direct members each, plus three other nodes. No generation
requests were started and no videos were playing. Original canvas data stayed
in its own browser context.

The comparisons are incremental: the sidebar baseline already includes the
graph-index optimization, and the drag baseline includes sidebar virtualization.
They are not both comparisons against unmodified upstream `main`.

Each scenario uses 30 identical operations before and after its change. Capture
CDP `Performance.getMetrics` deltas for `ScriptDuration` and `TaskDuration`, and
observe browser long tasks separately. Drag measurements also enable the CDP
Profiler in both runs. Script and task durations below are accumulated main-thread
CPU time, not elapsed interaction latency, individual frame latency, or FPS.

## Sidebar selection

The sidebar scenario uses zoom 0.537724. Select nodes 30 times with the sidebar
open, then repeat in grid mode. Also scroll to the last entry and resize the
panel. The viewport-sized list must not change search, selection, or export scope.

| Metric | Before | After | After, second sample |
| --- | ---: | ---: | ---: |
| Total DOM nodes during list selection | 46598 | 1034 | 1046 |
| Mounted sidebar entries | 4539 | 14 | 14 |
| List selection script time | 9368 ms | 977 ms | 1020 ms |
| List selection long-task total | 9296 ms | 482 ms | 463 ms |
| Grid selection script time | 7016 ms | 861 ms | 807 ms |
| Sidebar scrolling script time | 645 ms | 650 ms | 624 ms |

Selection improves substantially; scrolling script time does not show a material
improvement. Group-row construction is O(N), and mounted entries scale with the
visible rows. Indexing and backing list data remain O(N).

## Group dragging

Use zoom 0.1, select one group or all 28 groups, hold the pointer, issue 30 moves,
and release. Measure dragging and release separately. Repeat the same movement
and selection on both versions, including nodes that enter the viewport.

| Metric | Before | After |
| --- | ---: | ---: |
| One group / 162 elements, drag script time | 4553 ms | 866 ms |
| 28 groups / 4536 elements, drag script time | 23887 ms | 888 ms |
| 28 groups, drag task time | 26223 ms | 1543 ms |
| 28 groups, release script time | 1208 ms | 320 ms |
| 28 groups, long-task total including release | 25556 ms | 748 ms |

Dragging keeps committed nodes stable and paints transient positions; release
commits the latest coordinates once. Member collection is O(N). Release membership
lookup changes from O(M × N) to O(N + M × G), where M is the moving-node count and
G is the group count. Frame-level viewport culling still scans O(N + E); no
constant-time frame claim is made. The minimap projects the full graph when open.

## Regression checks

Run from `web/`:

```sh
bun test tests/canvas-node-drag.test.ts tests/canvas-node-list.test.ts tests/canvas-reference-rendering.test.ts tests/canvas-resource-index.test.ts
```

The targeted run passed 26 tests and 2169 assertions. It covers reference ordering,
plugins and locales, immutable inputs, 80 mixed/overlapping grouping cases,
concurrent content updates, deleted nodes, grid rows, and bulk relative positions.

Browser checks passed for search and empty results, 4200-video filtering, group
collapse/expand, last-row reachability, resizing, off-screen focus, both themes,
asset/prompt tab switching, and a complete 4539-entry selection export. During
dragging, 16 nodes entered the viewport and 316 visible edges stayed attached,
including 56 edges crossing the moving set. Release removed all preview transforms;
group membership, save/reload, undo/redo, and blur completion were checked.

Production build and type checking were not run, following repository instructions.
Real-media decoding/playback, geometry-dependent plugin UI, and minimap-open
performance still need manual verification. Release retains about 320 ms of
one-time script work in this development scenario; stable 60 FPS is not promised.
