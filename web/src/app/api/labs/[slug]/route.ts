import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { json, problem, readJson } from "@/lib/http";
import { labGuide, setSolutionsAllowed } from "@/lib/repos/labs";
import { labSettingsBody, slugParam } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

const notFound = () =>
  problem(
    404,
    "lab_not_found",
    "There is no lab with that name in your organization.",
  );

/** The guide as learners see it: steps and troubleshooting notes, never hints or solutions. */
export async function GET(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const slug = slugParam.safeParse((await params).slug);
  if (!slug.success) return notFound();
  const { session } = guard;
  const guide = await withTenant(session, (tx) =>
    labGuide(tx, slug.data, session.userId),
  );
  return guide ? json(guide) : notFound();
}

/** Instructors release or withhold the walkthroughs for graded steps. */
export async function PATCH(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const guard = await requireSession(request, ["instructor"]);
  if (!guard.ok) return guard.response;
  const slug = slugParam.safeParse((await params).slug);
  if (!slug.success) return notFound();
  const body = await readJson(request, labSettingsBody);
  if (!body.ok) return body.response;
  const updated = await withTenant(guard.session, (tx) =>
    setSolutionsAllowed(tx, slug.data, body.data.solutionsAllowed),
  );
  return updated
    ? json({ slug: slug.data, solutionsAllowed: body.data.solutionsAllowed })
    : notFound();
}
