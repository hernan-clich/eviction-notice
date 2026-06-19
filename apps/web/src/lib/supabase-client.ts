import { createClient } from '@supabase/supabase-js';

let client: ReturnType<typeof createClient> | null = null;

/**
 * Lazily create the browser client. Lazy (not module-level) so importing this
 * never throws during the build/prerender - the env check runs at first use, in
 * the browser, where NEXT_PUBLIC_* are inlined. Uses the publishable key, which
 * respects RLS (read-only here).
 */
export function getSupabase() {
  if (!client) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !publishableKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY - see apps/web/.env.example.',
      );
    }
    client = createClient(url, publishableKey);
  }
  return client;
}
