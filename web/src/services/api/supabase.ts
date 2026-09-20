import { createClient } from "@supabase/supabase-js";
import { AGENT_API_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/constant/runtime-config";

const url = SUPABASE_URL.trim();
const publishableKey = SUPABASE_PUBLISHABLE_KEY.trim();

export const supabase = url && publishableKey ? createClient(url, publishableKey) : null;
export const hostedAgentConfigured = Boolean(supabase && AGENT_API_URL);
