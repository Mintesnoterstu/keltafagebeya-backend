import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/** Strip accidental quotes/whitespace from Railway/Vercel env pastes */
function cleanEnv(value: string | undefined): string | undefined {
  if (value == null) return value;
  return value.trim().replace(/^["']|["']$/g, '');
}

// Normalize critical Telegram vars before Zod parse
if (process.env.TELEGRAM_BOT_TOKEN) {
  process.env.TELEGRAM_BOT_TOKEN = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
}
if (process.env.TELEGRAM_ADMIN_CHAT_ID) {
  process.env.TELEGRAM_ADMIN_CHAT_ID = cleanEnv(
    process.env.TELEGRAM_ADMIN_CHAT_ID
  );
}

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),

  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1)
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'TELEGRAM_BOT_TOKEN must look like 123456:AA...'),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  CHAPA_SECRET_KEY: z.string().min(1),
  CHAPA_WEBHOOK_SECRET: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  FRONTEND_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().min(1),

  /** Seconds; 0 = never expire auth_date. Default 30 days. */
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  PORT: Number(parsed.data.PORT),
  CORS_ORIGINS: parsed.data.CORS_ORIGIN.split(',').map((o) => o.trim()),
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
  TELEGRAM_AUTH_MAX_AGE_SECONDS: Number(
    parsed.data.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? String(30 * 86400)
  ),
  /** Bot numeric id prefix from token (before `:`) */
  TELEGRAM_BOT_ID: parsed.data.TELEGRAM_BOT_TOKEN.split(':')[0],
};
