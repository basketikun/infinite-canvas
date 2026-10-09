# Canvas Skill Nodes Design

## Status

The design and written specification were reviewed and approved by the user.

## Goal

Make Skills first-class nodes in the canvas workflow. A user should be able to connect one article to several Skills for parallel results, or connect Skill nodes in sequence so a later Skill processes the previous result.

Keep the implementation within the existing canvas and Canvas Agent. Do not add another Agent runtime, workflow engine, or Skill marketplace.

## Node behavior

- Add a built-in Skill node with one selected, locally managed Skill.
- A Skill node calls the currently configured Canvas Agent provider and model. Reuse the existing provider/model selection and defaults; do not add another credential or model configuration system.
- The node's user instruction stays in its prompt field. Text from incoming connections is passed separately as reference material. The selected Skill's instructions are fetched from Canvas Agent and used as system instructions.
- The node writes its generated text into its own content and uses the existing loading, cancellation, and error behavior. Its content can be copied, scrolled, and connected as input to another node.
- If the selected Skill is missing, disabled, or unavailable, show a visible warning and allow the user to choose another available Skill. Do not silently run without the selected Skill.
- Ordinary Agent text nodes remain available for generation without a selected Skill. Newly created ordinary Agent text nodes do not offer a Skill selector.
- Existing saved Agent text nodes with a Skill assignment continue to use that stored assignment. Do not automatically convert or migrate them.

## Graph behavior and creation

- Show Skill in the canvas node creation menu and the menu for creating a node from a connection.
- Multiple Skill nodes may connect to the same source text. Each node executes independently with its own Skill and instruction.
- A Skill node may connect to another Skill node. The downstream node receives the upstream node's generated text as reference material.
- Use the existing connection reference bar and graph connections; do not add a second reference mechanism.
- The request must distinguish reference text from the user's instruction. Keep the instruction field limited to the user's instruction, consistent with ordinary text Agent nodes.

## Settings and persistence

- Store only the selected Skill name and existing Agent provider/model settings on the node. Fetch Skill instructions at generation time through the existing Canvas Agent API; do not duplicate Skill bodies or credentials in canvas data.
- Reuse existing canvas project storage and workflow-template storage.
- A saved workflow keeps Skill selection, user instructions, Agent/model settings, and graph connections, while clearing generated text content when reopened, consistent with existing text-node template behavior.
- If a Skill referenced by a saved workflow is unavailable, retain the reference and show the missing-Skill warning until the user selects another Skill.

## Out of scope

- Multi-Skill selection inside one node; users compose multiple Skills by branching or chaining nodes.
- Automatic multi-step execution, batch scheduling, or autonomous workflow orchestration.
- A new Agent service, API credential store, or Skill management backend.
- Online Skill discovery or marketplace features.

## Acceptance criteria

1. A user can create a Skill node from either creation menu and choose an enabled local Skill.
2. Given one source article connected to two Skill nodes, each can run independently with a different Skill and show its own result.
3. Given Skill A connected to Skill B, running B sends A's generated text as reference material and keeps B's user instruction separate.
4. The selected Skill's instructions are sent as system instructions through the configured Agent provider and model.
5. Missing or disabled Skills are visible and can be reassigned; generation does not silently proceed without the configured Skill.
6. Skill-node content supports the existing text-node scroll and copy behavior and can be referenced by downstream nodes.
7. Saving and reopening a workflow preserves Skill choice, instructions, model/provider settings, and connections while clearing generated result text.
8. Existing Agent text nodes with a saved Skill assignment continue to work without automatic migration.
9. Ordinary Agent text generation without a Skill continues to work.

## Manual verification

- Connect one text article to two Skill nodes, select different Skills, run both, and confirm both results are visible and use the same upstream article.
- Connect the result of one Skill node to a second Skill node and confirm the second request receives the first result separately from its user instruction.
- Delete or disable a selected Skill in Canvas Agent and confirm the node warns instead of silently generating.
- Save and reopen a workflow containing Skill nodes; confirm settings and connections remain while generated text is cleared.
- Confirm ordinary Agent text generation and previously saved Agent nodes with a Skill assignment still behave as specified.

## Implementation notes

- The canvas already represents connections as `CanvasConnection`, displays incoming nodes in the reference bar, and resolves connected text resources in `canvas-node-generation.ts`.
- Skill execution already uses Canvas Agent APIs in the text generation path. The Skill node should reuse that request path and existing cancellation behavior.
- The node type must be included in built-in creation, rendering, reference-resource, and workflow-template handling. Keep changes focused on these integration points.
- The repository instructions ask not to run tests or builds after changes; implementation verification should use the documented manual checks unless the user requests automated verification.
