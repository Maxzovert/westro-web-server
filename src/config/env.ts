/**
 * Environment configuration
 * -------------------------
 * Loads `.env`, validates with Zod, and fails fast on bad config.
 * Never import `process.env` directly elsewhere — use `env` from here.
 */
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Storefront API listen port (Admin uses 4000; this server uses 4001 by default). */
  PORT: z.coerce.number().int().positive().default(4001),
  /** Shared business DB with Admin — one source of truth for catalog/orders. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Next.js storefront origin allowed for credentialed CORS. */
  CLIENT_ORIGIN: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return process.env.NODE_ENV === "production";
      }
      return value === "true";
    }),
  SESSION_IDLE_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  SESSION_ABSOLUTE_MS: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  /** HMAC secret used to verify payment provider webhooks. */
  PAYMENT_WEBHOOK_SECRET: z
    .string()
    .min(16)
    .default("dev-payment-webhook-secret"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
