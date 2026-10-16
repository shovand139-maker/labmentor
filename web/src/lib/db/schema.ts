import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every table except `tenants` carries `tenant_id`, and row-level security policies (see
 * drizzle/0001_row_level_security.sql) compare it with the tenant set on the transaction.
 * A test fails if a new table with a tenant_id column has no policy.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type Hints = { nudge?: string; hint?: string; walkthrough?: string };

export type CitationRecord = { id: string; title: string; step: number | null };

export type ToolRecord = { name: string; ok: boolean; summary: string };

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["learner", "instructor"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_tenant_email_key").on(t.tenantId, t.email),
    check("users_role_check", sql`${t.role} in ('learner', 'instructor')`),
  ],
);

export const labs = pgTable(
  "labs",
  {
    id: id(),
    tenantId: tenantId(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    solutionsAllowed: boolean("solutions_allowed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("labs_tenant_slug_key").on(t.tenantId, t.slug)],
);

export const labSteps = pgTable(
  "lab_steps",
  {
    id: id(),
    tenantId: tenantId(),
    labId: uuid("lab_id")
      .notNull()
      .references(() => labs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    graded: boolean("graded").notNull().default(false),
    hints: jsonb("hints").$type<Hints>().notNull().default({}),
    solution: jsonb("solution").$type<string[]>().notNull().default([]),
  },
  (t) => [unique("lab_steps_lab_position_key").on(t.labId, t.position)],
);

export const labFaq = pgTable(
  "lab_faq",
  {
    id: id(),
    tenantId: tenantId(),
    labId: uuid("lab_id")
      .notNull()
      .references(() => labs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
  },
  (t) => [unique("lab_faq_lab_position_key").on(t.labId, t.position)],
);

export const progress = pgTable(
  "progress",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    labId: uuid("lab_id")
      .notNull()
      .references(() => labs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.labId, t.position] })],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    labId: uuid("lab_id")
      .notNull()
      .references(() => labs.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [unique("conversations_user_lab_key").on(t.userId, t.labId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    currentStep: integer("current_step"),
    policy: text("policy", {
      enum: ["answered", "hint_only", "solution_withheld", "not_in_guide"],
    }),
    citations: jsonb("citations")
      .$type<CitationRecord[]>()
      .notNull()
      .default([]),
    tools: jsonb("tools").$type<ToolRecord[]>().notNull().default([]),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    confidence: real("confidence"),
    needsInstructor: boolean("needs_instructor").notNull().default(false),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    index("messages_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("messages_role_check", sql`${t.role} in ('user', 'assistant')`),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [check("feedback_rating_check", sql`${t.rating} in (-1, 1)`)],
);
