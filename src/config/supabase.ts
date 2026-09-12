import { createClient } from '@supabase/supabase-js';
import WS from 'ws';
import { env } from './env';

// Polyfill WebSocket for Node < 22 (Railway Nixpacks often defaults to Node 18)
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WS;
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: WS as any,
  },
});
