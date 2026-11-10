# Canvas reference benchmark

Run from `web/` with `bun benchmarks/canvas-references.ts`. This uses synthetic
graphs only and does not start generation, contact a provider, or access canvas
storage. The old selector lives in `tests/helpers/canvas-graph-fixtures.ts` as a
deliberately unindexed regression oracle. Both paths build the same labeled
references; results are checked node by node before timing.

The matrix has one shared prompt, N text nodes, and 15 video nodes per text node.
The benchmark alternates the old and new implementations after three warm-up
rounds and reports the median of nine samples. Indexed timings include graph
construction, resource eligibility, group indexing, and reference labeling.

- For this sparse matrix, full-graph reference construction changes from O(V²)
  to O(V + E), assuming average constant-time Map/Set operations.
- General graphs take O(V + E + R), where R includes inspected config peers and
  group-expanded candidate references before deduplication. Dense graphs can
  still produce quadratic candidate counts; plugin callback costs are separate.
- Adjacency and eligibility indexes add O(V + E) space and retain node references,
  not copies of media contents. Empty result entries are omitted; single-source
  reference arrays are shared within the current graph snapshot only.
- `entries`, `arrays`, and `objects` count result structures, not total heap usage
  or all intermediate allocations. Wall-clock values vary with runtime and load.

The page rebuilds indexes after nodes, connections, or plugin registration change.
Geometry-dependent plugin resources still see position updates. Localized labels
are rebuilt when the translation function changes. Rendering changes separately
remove forced SVG layer promotion and stabilize memoized edge/sidebar props.

Algorithm timings do not measure browser frame times, API generation latency, or
decoding/playback of hundreds of real videos. Validate panning, zooming, dragging,
selection/context menus, sidebar updates, and both themes in a real browser.
