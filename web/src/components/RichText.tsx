import { Fragment, type ReactNode } from "react";
import { citationLabel, paragraphs, tokenize } from "@/lib/inline";

type Props = {
  text: string;
  /** Render citation markers as buttons. Without it, markers are dropped (guide text has none). */
  onCite?: (citationId: string) => void;
};

export function RichText({ text, onCite }: Props): ReactNode {
  return paragraphs(text).map((paragraph, i) => (
    <p key={i}>
      {tokenize(paragraph).map((token, j) => {
        switch (token.kind) {
          case "code":
            return <code key={j}>{token.value}</code>;
          case "bold":
            return <strong key={j}>{token.value}</strong>;
          case "citation":
            return onCite ? (
              <button
                key={j}
                type="button"
                className="cite"
                onClick={() => onCite(token.id)}
                aria-label={`Show ${citationLabel(token.id)} in the guide`}
              >
                {citationLabel(token.id)}
              </button>
            ) : null;
          default:
            return <Fragment key={j}>{token.value}</Fragment>;
        }
      })}
    </p>
  ));
}
