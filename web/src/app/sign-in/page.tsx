import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { SignInList } from "@/components/Controls";
import { currentSession } from "@/lib/auth/guard";
import { DEMO_TENANTS, DEMO_USERS } from "@/lib/demo";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await currentSession()) redirect("/labs");
  const demo = env().DEMO_SIGN_IN;
  const people = DEMO_TENANTS.map((t) => ({
    organization: t.name,
    users: DEMO_USERS.filter((u) => u.tenantId === t.id),
  }));

  return (
    <>
      <AppHeader session={null} />
      <main className="sign-in">
        <div className="sign-in-intro">
          <p className="eyebrow">Hands-on labs, with help that teaches</p>
          <h1>Get unstuck without getting the answer handed to you.</h1>
          <p>
            LabMentor answers questions from the lab guide, cites the step it
            relied on, and gives hints instead of solutions for graded
            checkpoints. Instructors see which steps confuse people and which
            questions the guide does not answer.
          </p>
        </div>
        {demo ? (
          <div className="card sign-in-card">
            <h2 className="card-title">Sign in as a demo person</h2>
            <p className="muted">
              Two organizations, each isolated by row-level security in
              PostgreSQL.
            </p>
            <SignInList people={people} />
          </div>
        ) : (
          <div className="card sign-in-card">
            <h2 className="card-title">Sign-in is not configured</h2>
            <p className="muted">
              This deployment has demo sign-in turned off.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
