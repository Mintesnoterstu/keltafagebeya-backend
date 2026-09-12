import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    // Node < 22 has no native WebSocket; required on Railway Node 18
    transport: ws as unknown as typeof WebSocket,
  },
});
