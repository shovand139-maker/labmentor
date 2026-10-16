import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { json, problem, readJson } from "@/lib/http";
import { rateAnswer } from "@/lib/repos/conversations";
import { feedbackBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Thumbs up or down on one of your own answers. Thumbs down shows up in the instructor's insights. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  const body = await readJson(request, feedbackBody);
  if (!body.ok) return body.response;
  const saved =
    id.success &&
    (await withTenant(guard.session, (tx) =>
      rateAnswer(
        tx,
        guard.session,
        id.data,
        body.data.rating,
        body.data.comment,
      ),
    ));
  return saved
    ? json({ messageId: id.data, rating: body.data.rating })
    : problem(
        404,
        "answer_not_found",
        "There is no answer of yours with that id.",
      );
}
