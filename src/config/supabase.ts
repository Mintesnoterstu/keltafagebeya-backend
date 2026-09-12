import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from './env';

// Polyfill WebSocket for Node < 22 (Railway Nixpacks often defaults to Node 18)
const g = globalThis as typeof globalThis & { WebSocket?: unknown };
if (!g.WebSocket) {
  g.WebSocket = WebSocket;
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: WebSocket as any,
  },
});
