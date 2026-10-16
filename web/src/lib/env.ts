import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  ASSISTANT_URL: z.url(),
  ASSISTANT_SERVICE_KEY: z.string().min(1).optional(),
  DEMO_SIGN_IN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  QUESTIONS_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(8),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Read and validate the environment on first use, so `next build` does not need production secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid environment: ${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}
