"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { anchorFor } from "@/lib/inline";
import { readEvents } from "@/lib/sse";
import type { MessageDto, Policy } from "@/lib/types";
import { RichText } from "./RichText";

const TOOL_ACTIVITY: Record<string, string> = {
  search_guide: "Searching the guide",
  get_step: "Reading the step",
  learner_progress: "Checking your progress",
  get_hint: "Getting your instructor's hint",
};

const BADGES: Partial<
  Record<Policy, { label: string; tone: string; title: string }>
> = {
  hint_only: {
    label: "Hint",
    tone: "hint",
    title: "A hint written by your instructor.",
  },
  solution_withheld: {
    label: "Solution withheld",
    tone: "withheld",
    title: "This step is graded, so the full solution is not shown.",
  },
  not_in_guide: {
    label: "Sent to your instructor",
    tone: "flagged",
    title:
      "The guide does not cover this. Your instructor can see the question.",
  },
};

type Props = {
  slug: string;
  initial: MessageDto[];
  suggestions: string[];
};

export function showInGuide(citationId: string): void {
  const target = document.getElementById(anchorFor(citationId));
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("flash");
  // Restart the highlight animation even when the same passage is cited twice in a row.
  void target.offsetWidth;
  target.classList.add("flash");
}

export function ChatPanel({ slug, initial, suggestions }: Props) {
  const [messages, setMessages] = useState<MessageDto[]>(initial);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({
      top: log.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, partial, activity]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setActivity("Reading your question");
    try {
      const response = await fetch(`/api/labs/${slug}/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setError(body?.detail ?? "The question could not be sent.");
        return;
      }
      for await (const { event, data } of readEvents(response.body)) {
        const payload = JSON.parse(data);
        if (event === "accepted") {
          setMessages((m) => [...m, payload.question as MessageDto]);
          setDraft("");
        } else if (event === "tool" && payload.status === "running") {
          setActivity(TOOL_ACTIVITY[payload.name as string] ?? "Working on it");
        } else if (event === "delta") {
          setActivity(null);
          setPartial((p) => (p ?? "") + (payload.text as string));
        } else if (event === "done") {
          setMessages((m) => [...m, payload.answer as MessageDto]);
          setPartial(null);
        } else if (event === "error") {
          setError(payload.message as string);
        }
      }
    } catch {
      setError("The connection dropped before the answer finished. Try again.");
    } finally {
      setBusy(false);
      setPartial(null);
      setActivity(null);
    }
  }

  async function rate(message: MessageDto, rating: 1 | -1) {
    const next = message.rating === rating ? null : rating;
    if (next === null) return;
    setMessages((all) =>
      all.map((m) => (m.id === message.id ? { ...m, rating: next } : m)),
    );
    const response = await fetch(`/api/messages/${message.id}/feedback`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: next }),
    });
    if (!response.ok) {
      setMessages((all) =>
        all.map((m) =>
          m.id === message.id ? { ...m, rating: message.rating } : m,
        ),
      );
      setError("Your rating was not saved.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  }

  return (
    <section className="chat" aria-label="Ask LabMentor">
      <header className="chat-head">
        <h2>Ask LabMentor</h2>
        <p>
          Answers come from this lab&apos;s guide, with links to the step they
          rely on.
        </p>
      </header>

      <div
        className="chat-log"
        ref={log}
        role="log"
        aria-live="polite"
        aria-busy={busy}
      >
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p>
              Stuck, or not sure why something failed? Ask in your own words.
            </p>
            <ul>
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="suggestion"
                    onClick={() => void ask(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bubble bubble-user">
              <p>{m.content}</p>
            </div>
          ) : (
            <article
              key={m.id}
              className="bubble bubble-answer"
              data-testid="answer"
              data-policy={m.policy ?? ""}
            >
              {m.policy && BADGES[m.policy] && (
                <span
                  className={`badge badge-${BADGES[m.policy]!.tone}`}
                  title={BADGES[m.policy]!.title}
                >
                  {BADGES[m.policy]!.label}
                </span>
              )}
              <RichText text={m.content} onCite={showInGuide} />
              <footer className="answer-foot">
                <span className="answer-meta">
                  {m.citations.length > 0
                    ? `${m.citations.length} source${m.citations.length > 1 ? "s" : ""}`
                    : "No sources"}
                </span>
                <span
                  className="rate"
                  role="group"
                  aria-label="Rate this answer"
                >
                  <button
                    type="button"
                    aria-pressed={m.rating === 1}
                    aria-label="Helpful"
                    className={m.rating === 1 ? "on" : ""}
                    onClick={() => void rate(m, 1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-pressed={m.rating === -1}
                    aria-label="Not helpful"
                    className={m.rating === -1 ? "on" : ""}
                    onClick={() => void rate(m, -1)}
                  >
                    ▼
                  </button>
                </span>
              </footer>
            </article>
          ),
        )}

        {partial !== null && (
          <article
            className="bubble bubble-answer streaming"
            aria-label="Answer in progress"
          >
            <RichText text={partial} />
          </article>
        )}
        {activity && (
          <p className="activity" data-testid="activity">
            <span className="dots" aria-hidden="true" />
            {activity}
          </p>
        )}
      </div>

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <textarea
          id="question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this lab…"
          rows={2}
          maxLength={2000}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          {busy ? "Answering…" : "Ask"}
        </button>
      </form>
    </section>
  );
}
