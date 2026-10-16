"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DemoUser } from "@/lib/demo";

async function send(
  url: string,
  method: string,
  body?: unknown,
): Promise<boolean> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.ok;
}

export function StepDone({
  slug,
  position,
  completed,
}: {
  slug: string;
  position: number;
  completed: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(completed);
  const [pending, startTransition] = useTransition();

  async function toggle(next: boolean) {
    setChecked(next);
    const ok = await send(`/api/labs/${slug}/progress`, "PUT", {
      position,
      completed: next,
    });
    if (!ok) setChecked(!next);
    else startTransition(() => router.refresh());
  }

  return (
    <label className="step-done">
      <input
        type="checkbox"
        checked={checked}
        disabled={pending}
        onChange={(e) => void toggle(e.target.checked)}
      />
      Done
    </label>
  );
}

export function SolutionsToggle({
  slug,
  allowed,
}: {
  slug: string;
  allowed: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(allowed);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    setValue(next);
    setError(false);
    if (await send(`/api/labs/${slug}`, "PATCH", { solutionsAllowed: next }))
      router.refresh();
    else {
      setValue(!next);
      setError(true);
    }
  }

  return (
    <div className="toggle-row">
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={value}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>Release walkthroughs for graded steps</span>
      </label>
      <p className="hint-text">
        {value
          ? "Learners can ask for full walkthroughs of graded checkpoints."
          : "LabMentor gives hints for graded checkpoints but never the full solution."}
        {error && " The change was not saved."}
      </p>
    </div>
  );
}

export function SignInList({
  people,
}: {
  people: { organization: string; users: DemoUser[] }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(user: DemoUser) {
    setBusy(user.id);
    setError(null);
    if (await send("/api/session", "POST", { userId: user.id })) {
      router.push("/labs");
      router.refresh();
    } else {
      setBusy(null);
      setError("Sign-in failed. Is the database seeded?");
    }
  }

  return (
    <div className="people">
      {people.map((group) => (
        <section key={group.organization} className="people-group">
          <h2>{group.organization}</h2>
          <ul>
            {group.users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="person"
                  disabled={busy !== null}
                  onClick={() => void signIn(u)}
                >
                  <span className="avatar" aria-hidden="true">
                    {u.name
                      .split(" ")
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <span className="person-name">{u.name}</span>
                  <span className={`role role-${u.role}`}>
                    {u.role === "instructor" ? "Instructor" : "Learner"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="link-button"
      onClick={async () => {
        await send("/api/session", "DELETE");
        router.push("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
