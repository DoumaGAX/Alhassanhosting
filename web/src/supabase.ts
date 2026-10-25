import { createClient } from "@supabase/supabase-js";
const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!rawUrl || !key) {
  throw new Error("Missing Supabase environment variables.");
}
const url = rawUrl
  .trim()
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/+$/, "");
export const supabase = createClient(url, key);