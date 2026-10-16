"""A deterministic stand-in for a hosted model.

It drives the same tool loop a hosted model does, reading tool results as text, and writes extractive answers
from the passages it retrieved. It lets the app run end to end without an API key, and it makes the evals and
end-to-end tests repeatable. It is not meant to be clever: when a question needs reasoning across passages,
the hosted providers do better, and the evals report says which provider produced the numbers.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ..prompts import NOT_IN_GUIDE
from ..text import sentences, terms, words
from .base import Message, ModelReply, ToolCall, ToolResult, ToolSpec, UserMessage

ANSWER_THRESHOLD = 0.3

_PASSAGE = re.compile(
    r'<passage id="(?P<id>[^"]+)" title="(?P<title>[^"]*)" relevance="(?P<relevance>[0-9.]+)"'
    r'(?P<graded> graded="true")?>\n'
    r"(?P<text>.*?)\n</passage>",
    re.DOTALL,
)
_STEP_REFERENCE = re.compile(r"\b(?:step|checkpoint)\s*#?\s*(\d{1,2})\b", re.IGNORECASE)
_WANTS_SOLUTION = re.compile(
    r"\b(solution|full answer|the answer|exact (command|commands|code|query)|full (command|code)|complete command"
    r"|just (tell|give|show) me|give me the (command|commands|code|answer)"
    r"|what (exactly )?(do|should) i (type|run|enter)"
    r"|walk ?me ?through|walkthrough|step[- ]by[- ]step)\b",
    re.IGNORECASE,
)
_WANTS_HINT = re.compile(r"\b(hint|clue|nudge|stuck|i'?m lost|point me|help me get started)\b", re.IGNORECASE)


@dataclass(frozen=True)
class _Passage:
    id: str
    title: str
    relevance: float
    graded: bool
    text: str

    @property
    def step(self) -> int | None:
        match = re.match(r"step-(\d+)", self.id)
        return int(match.group(1)) if match else None


def _estimate_tokens(text: str) -> int:
    return max(1, round(len(text.split()) * 1.3))


class OfflineProvider:
    name = "offline"
    model = "labmentor-offline-1"

    async def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> ModelReply:
        question_index = max(i for i, m in enumerate(messages) if isinstance(m, UserMessage))
        question = messages[question_index]
        assert isinstance(question, UserMessage)
        results = [m for m in messages[question_index + 1 :] if isinstance(m, ToolResult)]
        prompt_size = _estimate_tokens(system) + sum(
            _estimate_tokens(getattr(m, "content", "") or getattr(m, "text", "")) for m in messages
        )
        reply_text, calls = self._next(question.content, results, len(messages))
        return ModelReply(
            text=reply_text,
            tool_calls=calls,
            model=self.model,
            input_tokens=prompt_size,
            output_tokens=_estimate_tokens(reply_text) if reply_text else 8 * len(calls),
        )

    def _next(self, question: str, results: list[ToolResult], turn: int) -> tuple[str, list[ToolCall]]:
        if not results:
            return "", [
                ToolCall(f"call_{turn}_1", "learner_progress", {}),
                ToolCall(f"call_{turn}_2", "search_guide", {"query": question}),
            ]

        progress: dict[str, Any] = {}
        passages: list[_Passage] = []
        hint: dict[str, Any] | None = None
        for result in results:
            if result.is_error:
                continue
            if result.name == "learner_progress":
                progress = json.loads(result.content)
            elif result.name in {"search_guide", "get_step"}:
                passages.extend(
                    _Passage(m["id"], m["title"], float(m["relevance"]), bool(m["graded"]), m["text"])
                    for m in _PASSAGE.finditer(result.content)
                )
            elif result.name == "get_hint":
                hint = json.loads(result.content)

        wants_solution = bool(_WANTS_SOLUTION.search(question))
        wants_hint = wants_solution or bool(_WANTS_HINT.search(question))
        target = self._target_step(question, passages, progress)

        if hint is None and wants_hint and target is not None:
            level = "walkthrough" if wants_solution else "hint"
            return "", [ToolCall(f"call_{turn}_1", "get_hint", {"position": target, "level": level})]
        if hint is not None:
            return self._hint_answer(hint), []
        return self._extractive_answer(question, passages), []

    @staticmethod
    def _target_step(question: str, passages: list[_Passage], progress: dict[str, Any]) -> int | None:
        explicit = _STEP_REFERENCE.search(question)
        if explicit:
            return int(explicit.group(1))
        ranked = [p for p in passages if p.step is not None and p.relevance >= ANSWER_THRESHOLD - 0.1]
        if ranked:
            return ranked[0].step
        current = progress.get("current_step")
        return int(current) if isinstance(current, int) else None

    @staticmethod
    def _hint_answer(hint: dict[str, Any]) -> str:
        position, title, text, cite = hint["position"], hint["step_title"], hint.get("text"), hint["cite"]
        if not text:
            return f"There's no hint written for step {position} yet. I've flagged that for your instructor. [{cite}]"
        if not hint["allowed"]:
            return (
                f"Step {position} ({title}) is a graded checkpoint, so I can't give you the full solution. "
                f"Here's a hint instead: {text} [{cite}]"
            )
        if hint["level"] == "walkthrough":
            return f"Here's the walkthrough for step {position}, {title}: {text} [{cite}]"
        return f"Here's a hint for step {position}, {title}: {text} [{cite}]"

    @staticmethod
    def _extractive_answer(question: str, passages: list[_Passage]) -> str:
        unique: list[_Passage] = []
        for passage in passages:
            if all(p.id != passage.id for p in unique):
                unique.append(passage)
        relevant = [p for p in unique if p.relevance >= ANSWER_THRESHOLD]
        if not relevant:
            return NOT_IN_GUIDE
        best = relevant[0]
        chosen = [best] + [p for p in relevant[1:2] if p.relevance >= 0.85 * best.relevance]

        query = set(terms(question))
        parts = []
        for passage in chosen:
            candidates = sentences(passage.text)
            if passage.id.startswith("faq-") and len(candidates) <= 4:
                # A troubleshooting note is already a short answer: the cause, then the fix. Keep all of it.
                parts.append(f"{' '.join(candidates)} [{passage.id}]")
                continue
            overlap = [len(query & set(terms(sentence))) for sentence in candidates]
            best_overlap = max(overlap, default=0)
            # The best-matching sentences, plus near misses: the sentence that names the value often shares
            # one word fewer with the question than the sentence that introduces it.
            ranked = sorted(range(len(candidates)), key=lambda i: (-overlap[i], i))
            picked = sorted(i for i in ranked[:3] if overlap[i] >= max(1, best_overlap - 1)) or [0]
            excerpt = " ".join(candidates[i] for i in picked)
            parts.append(f"{excerpt} [{passage.id}]")
        answer = " ".join(parts)
        return answer if words(answer) else NOT_IN_GUIDE
