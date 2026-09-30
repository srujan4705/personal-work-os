import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optionalStr = z.string().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_URL: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  // Express 'trust proxy': hop count (e.g. 1 behind one proxy, 2 behind Vercel + Render), true/false, or a subnet list.
  TRUST_PROXY: z.string().default('1'),
  // Optional CA certificate (PEM text or base64 of it) to verify the database TLS certificate (e.g. Supabase CA).
  DATABASE_SSL_CA: optionalStr,
  WEB_DIST_DIR: optionalStr,

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.optional(),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),

  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  ADMIN_NAME: z.string().default('Me'),
  ADMIN_TIMEZONE: z.string().default('UTC'),

  SCHEDULER_ENABLED: bool.default(true),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(10).default(60),
  // Enables POST /api/v1/internal/cron/tick for external schedulers. Unset = endpoint disabled.
  CRON_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

  ZOHO_CLIENT_ID: optionalStr,
  ZOHO_CLIENT_SECRET: optionalStr,
  ZOHO_DATA_CENTER: z.enum(['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa']).default('com'),
  ZOHO_REDIRECT_URI: optionalStr,
  ZOHO_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(30),
  ZOHO_SYNC_PAST_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  ZOHO_SYNC_FUTURE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  ZOHO_DEBUG_SHAPES: bool.default(false),

  GITHUB_TOKEN: optionalStr,
  GITHUB_REPOS: optionalStr,
  GITHUB_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),
  GITHUB_SYNC_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  JIRA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),

  AI_PROVIDER: z.enum(['none', 'gemini', 'openrouter', 'ollama']).default('none'),
  GEMINI_API_KEY: optionalStr,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENROUTER_API_KEY: optionalStr,
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1'),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(2000).default(24000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).default(1024),
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(10).default(5),
  AI_RETRY_LIMIT: z.coerce.number().int().min(0).max(3).default(1),
  AI_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),

  TELEGRAM_MODE: z.enum(['off', 'webhook', 'polling']).default('off'),
  TELEGRAM_BOT_TOKEN: optionalStr,
  TELEGRAM_BOT_USERNAME: optionalStr,
  TELEGRAM_WEBHOOK_SECRET: optionalStr,

  SMTP_HOST: optionalStr,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: optionalStr,
  SMTP_PASSWORD: optionalStr,
  SMTP_FROM: optionalStr,
  EMAIL_SUBJECT_PREFIX: z.string().default('[Work OS]'),

  VAPID_PUBLIC_KEY: optionalStr,
  VAPID_PRIVATE_KEY: optionalStr,
  VAPID_SUBJECT: optionalStr,

  RATE_LIMIT_LOGIN_PER_15MIN: z.coerce.number().int().default(10),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().default(300),
  RATE_LIMIT_ASSISTANT_PER_MIN: z.coerce.number().int().default(20),
  RATE_LIMIT_SYNC_PER_MIN: z.coerce.number().int().default(6),
  RATE_LIMIT_NOTIFY_PER_MIN: z.coerce.number().int().default(10),
  RATE_LIMIT_TELEGRAM_PER_MIN: z.coerce.number().int().default(60),
  RATE_LIMIT_CRON_PER_MIN: z.coerce.number().int().default(30),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings from .env files as "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const cookieSecure = env.COOKIE_SECURE ?? isProduction;

/** Converts TRUST_PROXY to what Express accepts: a hop count, a boolean, or a subnet list. */
export function trustProxySetting(value: string): number | boolean | string {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}
