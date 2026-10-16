import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Session } from "../auth/session";
import type { Tx } from "../db/tenant";
import {
  conversations,
  feedback,
  messages,
  type CitationRecord,
  type ToolRecord,
} from "../db/schema";
import type { MessageDto, Policy } from "../types";

export async function conversationFor(
  tx: Tx,
  session: Session,
  labId: string,
): Promise<string> {
  await tx
    .insert(conversations)
    .values({ tenantId: session.tenantId, userId: session.userId, labId })
    .onConflictDoNothing({
      target: [conversations.userId, conversations.labId],
    });
  const [row] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, session.userId),
        eq(conversations.labId, labId),
      ),
    );
  if (!row) throw new Error("conversation was not created");
  return row.id;
}

export async function existingConversation(
  tx: Tx,
  session: Session,
  labId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, session.userId),
        eq(conversations.labId, labId),
      ),
    );
  return row?.id ?? null;
}

const messageColumns = {
  id: messages.id,
  role: messages.role,
  content: messages.content,
  createdAt: messages.createdAt,
  currentStep: messages.currentStep,
  policy: messages.policy,
  citations: messages.citations,
  needsInstructor: messages.needsInstructor,
  confidence: messages.confidence,
  rating: feedback.rating,
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  currentStep: number | null;
  policy: Policy | null;
  citations: CitationRecord[];
  needsInstructor: boolean;
  confidence: number | null;
  rating: number | null;
};

export function toDto(row: MessageRow): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    currentStep: row.currentStep,
    policy: row.policy,
    citations: row.citations,
    needsInstructor: row.needsInstructor,
    confidence: row.confidence,
    rating: row.rating === 1 || row.rating === -1 ? row.rating : null,
  };
}

export async function listMessages(
  tx: Tx,
  session: Session,
  conversationId: string,
  limit = 100,
): Promise<MessageDto[]> {
  const rows = await tx
    .select(messageColumns)
    .from(messages)
    .leftJoin(
      feedback,
      and(
        eq(feedback.messageId, messages.id),
        eq(feedback.userId, session.userId),
      ),
    )
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.role))
    .limit(limit);
  return rows.reverse().map(toDto);
}

/** The last turns, oldest first, for the assistant's context window. */
export async function recentTurns(tx: Tx, conversationId: string, turns = 10) {
  const rows = await tx
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.role))
    .limit(turns);
  return rows.reverse();
}

export async function questionsInLastMinute(
  tx: Tx,
  conversationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "user"),
        gt(messages.createdAt, sql`now() - interval '1 minute'`),
      ),
    );
  return row?.n ?? 0;
}

export async function addQuestion(
  tx: Tx,
  session: Session,
  conversationId: string,
  content: string,
  currentStep: number | null,
): Promise<MessageDto> {
  const [row] = await tx
    .insert(messages)
    .values({
      tenantId: session.tenantId,
      conversationId,
      role: "user",
      content,
      currentStep,
    })
    .returning();
  return toDto({ ...row!, rating: null });
}

export type AnswerRecord = {
  answer: string;
  citations: CitationRecord[];
  policy: Policy;
  needsInstructor: boolean;
  confidence: number;
  tools: ToolRecord[];
  flags: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export async function addAnswer(
  tx: Tx,
  session: Session,
  conversationId: string,
  currentStep: number | null,
  answer: AnswerRecord,
): Promise<MessageDto> {
  const [row] = await tx
    .insert(messages)
    .values({
      tenantId: session.tenantId,
      conversationId,
      role: "assistant",
      content: answer.answer,
      currentStep,
      policy: answer.policy,
      citations: answer.citations,
      tools: answer.tools,
      flags: answer.flags,
      confidence: answer.confidence,
      needsInstructor: answer.needsInstructor,
      model: answer.model,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
      latencyMs: answer.latencyMs,
    })
    .returning();
  return toDto({ ...row!, rating: null });
}

/** Thumbs up or down on an answer the caller can see. Returns false when the message is not theirs to rate. */
export async function rateAnswer(
  tx: Tx,
  session: Session,
  messageId: string,
  rating: 1 | -1,
  comment: string | null,
): Promise<boolean> {
  const [message] = await tx
    .select({ id: messages.id, owner: conversations.userId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.role, "assistant")));
  if (!message || message.owner !== session.userId) return false;
  await tx
    .insert(feedback)
    .values({
      messageId,
      tenantId: session.tenantId,
      userId: session.userId,
      rating,
      comment,
    })
    .onConflictDoUpdate({
      target: feedback.messageId,
      set: { rating, comment },
    });
  return true;
}
