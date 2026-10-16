import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { SignOutButton } from "./Controls";

export function AppHeader({
  session,
  organization,
}: {
  session: Session | null;
  organization?: string | null;
}) {
  return (
    <header className="topbar">
      <Link href={session ? "/labs" : "/sign-in"} className="brand">
        <span className="brand-mark" aria-hidden="true">
          ›_
        </span>
        LabMentor
      </Link>
      {session && (
        <>
          <nav aria-label="Main">
            <Link href="/labs">Labs</Link>
            {session.role === "instructor" && (
              <Link href="/insights">Insights</Link>
            )}
          </nav>
          <div className="who">
            <span className="who-name">{session.name}</span>
            <span className="who-org">
              {organization} ·{" "}
              {session.role === "instructor" ? "Instructor" : "Learner"}
            </span>
          </div>
          <SignOutButton />
        </>
      )}
    </header>
  );
}
