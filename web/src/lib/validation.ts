import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(1, "Must not be empty.")
        .max(max, `Must be at most ${max} characters.`),
    );

export const signInBody = z.object({ userId: z.uuid() }).strict();

export const questionBody = z.object({ question: text(2_000) }).strict();

export const progressBody = z
  .object({ position: z.int().min(1).max(100), completed: z.boolean() })
  .strict();

export const labSettingsBody = z
  .object({ solutionsAllowed: z.boolean() })
  .strict();

export const feedbackBody = z
  .object({
    rating: z.union([z.literal(1), z.literal(-1)]),
    comment: z
      .string()
      .max(1_000, "Must be at most 1000 characters.")
      .transform((s) => s.trim() || null)
      .nullable()
      .default(null),
  })
  .strict();

export const insightsQuery = z.object({
  lab: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/, "Not a lab slug."),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const slugParam = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);
