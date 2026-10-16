import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { json, problem, readJson } from "@/lib/http";
import { setStepCompleted } from "@/lib/repos/labs";
import { progressBody, slugParam } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const guard = await requireSession(request);
  if (!guard.ok) return guard.response;
  const slug = slugParam.safeParse((await params).slug);
  const body = await readJson(request, progressBody);
  if (!body.ok) return body.response;
  const completed = slug.success
    ? await withTenant(guard.session, (tx) =>
        setStepCompleted(
          tx,
          guard.session,
          slug.data,
          body.data.position,
          body.data.completed,
        ),
      )
    : null;
  if (!completed)
    return problem(404, "step_not_found", "That lab or step does not exist.");
  return json({ completed });
}
