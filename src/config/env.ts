import { z } from 'zod';

/**
 * Server-side environment parsing.
 *
 * DATABASE_URL and the payment/auth secrets are optional in Phase 1 so the
 * foundation builds and deploys without any provisioned backend. They become
 * required in the phase that first uses them, at which point the schema below
 * is tightened rather than duplicated elsewhere.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),

  // Phase 2+
  DATABASE_URL: z.string().min(1).optional(),

  // Phase 4+. Sandbox only until production is explicitly approved.
  PAYPAL_ENVIRONMENT: z.literal('sandbox').default('sandbox'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Parses and caches server environment variables.
 *
 * Called lazily so that a missing optional variable never breaks the build.
 */
export function serverEnv(): ServerEnv {
  if (cached === undefined) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      // Surfaces the offending variable names without printing their values.
      const fields = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
      throw new Error(`Invalid environment configuration. Check: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
