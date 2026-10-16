"""Checks that run on what goes into the model and on what comes out of it.

None of these replace the instructions in the system prompt. They catch the cases where the model does not
follow them, and each one is deterministic so it can be unit tested and measured in the evals.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Citation, Lab, LabStep
from .retrieval import Passage

_INJECTION = re.compile(
    r"\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|rules|prompts?|guidelines)\b"
    r"|\byou are now\b"
    r"|\b(reveal|print|show|repeat)\b[^.\n]{0,30}\b(system prompt|your (instructions|prompt))\b"
    r"|\bnew instructions\s*:",
    re.IGNORECASE,
)
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+")

_ID = r"(?:step|faq)-\d+(?:-\d+)?"
_CITATION_GROUP = re.compile(rf"\[\s*({_ID}(?:\s*,\s*{_ID})*)\s*\]")


def screen_retrieved_text(text: str) -> tuple[str, bool]:
    """Drop sentences that try to instruct the model. Returns the cleaned text and whether anything was dropped.

    Lab content is written by instructors, but troubleshooting notes can come from learners, and a model should
    never take orders from the documents it reads.
    """
    dropped = False
    lines: list[str] = []
    for line in text.split("\n"):
        parts = _SENTENCE_BREAK.split(line)
        kept = [part for part in parts if not _INJECTION.search(part)]
        dropped = dropped or len(kept) != len(parts)
        lines.append(" ".join(kept))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip(), dropped


@dataclass(frozen=True)
class CitationCheck:
    text: str
    citations: list[Citation]
    removed: list[str]


def check_citations(answer: str, known: dict[str, Passage]) -> CitationCheck:
    """Keep only citations of passages the tools actually returned in this turn.

    ``[step-3, faq-1]`` is normalised to ``[step-3][faq-1]``. Unknown ids are removed from the text so the
    learner never sees a link to something the model did not read.
    """
    removed: list[str] = []
    cited: list[str] = []

    def replace(match: re.Match[str]) -> str:
        ids = [part.strip() for part in match.group(1).split(",")]
        good = [i for i in ids if i in known]
        removed.extend(i for i in ids if i not in known)
        for i in good:
            if i not in cited:
                cited.append(i)
        return "".join(f"[{i}]" for i in good)

    text = _CITATION_GROUP.sub(replace, answer)
    text = re.sub(r"[ \t]+([.,;:!?])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    citations = [Citation(id=i, title=known[i].title, step=known[i].step) for i in cited]
    return CitationCheck(text, citations, removed)


_EDGE_PUNCTUATION = "`'\";,()[]{}<>.:!?"


def _command_tokens(text: str) -> list[str]:
    tokens = []
    for raw in text.replace("\\\n", " ").split():
        token = raw.strip(_EDGE_PUNCTUATION).lower()
        if token and token not in {"=", "-", "|"}:
            tokens.append(token)
    return tokens


def _distinctive(token: str) -> bool:
    """Flags, names and values: the parts of a command that make it the answer rather than a description."""
    return (
        token.startswith("-")
        or any(c in token for c in "./@$_:")
        or any(c.isdigit() for c in token)
        or ("-" in token[1:])
    )


def find_solution_leak(answer: str, lab: Lab) -> LabStep | None:
    """Return the graded step whose solution the answer gives away, if any.

    A solution counts as given away when every distinctive token of one of its commands appears in the answer
    and the answer covers at least 75% of the command's tokens. Hints written by instructors deliberately name
    command groups without the flags and values, so they pass.
    """
    if lab.solutions_allowed:
        return None
    answer_tokens = set(_command_tokens(answer))
    for step in lab.steps:
        if not step.graded:
            continue
        for command in step.solution:
            tokens = _command_tokens(command)
            if not tokens:
                continue
            distinctive = [t for t in tokens if _distinctive(t)]
            if distinctive and not all(t in answer_tokens for t in distinctive):
                continue
            coverage = sum(1 for t in tokens if t in answer_tokens) / len(tokens)
            if coverage >= 0.75:
                return step
    return None
