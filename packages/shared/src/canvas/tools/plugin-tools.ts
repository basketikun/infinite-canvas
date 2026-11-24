import { z } from "zod";

export const agentCatalogRequest = "plugin_tools_list";
export const agentToolCallSchema = z.object({ binding: z.string().uuid(), input: z.record(z.unknown()) }).strict();
const objectSchema = z.object({ type: z.literal("object") }).passthrough();
export const agentToolNameSchema = z.string().regex(/^plugin_(?:read|call)_[a-z0-9-]+_[A-Za-z0-9_-]+$/);
export const agentToolDescriptorSchema = z.object({
    name: agentToolNameSchema, description: z.string(),
    binding: z.string().uuid(), readOnly: z.boolean(), inputSchema: objectSchema, outputSchema: objectSchema,
}).strict();
export type AgentToolDescriptor = z.infer<typeof agentToolDescriptorSchema>;
