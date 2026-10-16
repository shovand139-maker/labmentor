import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { labs } from "@/lib/db/schema";
import { withTenant } from "@/lib/db/tenant";
import { json, problem } from "@/lib/http";
import { existingConversation, listMessages } from "@/lib/repos/conversations";
import { slugParam } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** The caller's own conversation about this lab. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const slug = slugParam.safeParse((await params).slug);
  if (!slug.success)
    return problem(
      404,
      "lab_not_found",
      "There is no lab with that name in your organization.",
    );
  const { session } = guard;
  const result = await withTenant(session, async (tx) => {
    const [lab] = await tx
      .select({ id: labs.id })
      .from(labs)
      .where(eq(labs.slug, slug.data));
    if (!lab) return null;
    const conversationId = await existingConversation(tx, session, lab.id);
    return conversationId ? listMessages(tx, session, conversationId) : [];
  });
  return result
    ? json({ messages: result })
    : problem(
        404,
        "lab_not_found",
        "There is no lab with that name in your organization.",
      );
}
