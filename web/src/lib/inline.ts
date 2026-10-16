/**
 * A deliberately small Markdown subset for lab text and answers: paragraphs, `code`, **bold** and
 * citation markers like [step-3] or [faq-2]. Rendering builds React elements from these tokens, so no HTML
 * from the database or the model is ever injected into the page.
 */

export type Token =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "citation"; id: string };

const PATTERN =
  /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[((?:step|faq)-\d+(?:-\d+)?)\]/g;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last)
      tokens.push({ kind: "text", value: text.slice(last, index) });
    if (match[1] !== undefined) tokens.push({ kind: "code", value: match[1] });
    else if (match[2] !== undefined)
      tokens.push({ kind: "bold", value: match[2] });
    else if (match[3] !== undefined)
      tokens.push({ kind: "citation", id: match[3] });
    last = index + match[0].length;
  }
  if (last < text.length)
    tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** `step-3-2` and `step-3` both point at step 3 in the guide; `faq-2` at the second troubleshooting note. */
export function anchorFor(citationId: string): string {
  const step = /^step-(\d+)/.exec(citationId);
  if (step) return `guide-step-${step[1]}`;
  const faq = /^faq-(\d+)/.exec(citationId);
  return faq ? `guide-faq-${faq[1]}` : "";
}

export function citationLabel(citationId: string): string {
  const step = /^step-(\d+)/.exec(citationId);
  if (step) return `Step ${step[1]}`;
  const faq = /^faq-(\d+)/.exec(citationId);
  return faq ? `Troubleshooting ${faq[1]}` : citationId;
}
