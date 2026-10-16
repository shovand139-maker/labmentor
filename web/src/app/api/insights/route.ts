import { requireSession } from "@/lib/auth/guard";
import { withTenant } from "@/lib/db/tenant";
import { json, problem, validationProblem } from "@/lib/http";
import { labInsights } from "@/lib/repos/insights";
import { insightsQuery } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/insights?lab=<slug>&days=30 — instructors only. */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireSession(request, ["instructor"]);
  if (!guard.ok) return guard.response;
  const query = insightsQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationProblem(query.error);
  const insights = await withTenant(guard.session, (tx) =>
    labInsights(tx, query.data.lab, query.data.days),
  );
  return insights
    ? json(insights)
    : problem(
        404,
        "lab_not_found",
        "There is no lab with that name in your organization.",
      );
}
