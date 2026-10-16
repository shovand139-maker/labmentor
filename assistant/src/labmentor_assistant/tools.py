"""The tools the model can call, and the policy behind them.

Tools return text for the model. They also record what they returned, so the answer can be checked against
it afterwards: only passages a tool returned may be cited, and the hint policy decides which answers count
as withheld solutions.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from html import escape
from typing import Any, Literal

from .guardrails import screen_retrieved_text
from .models import Lab
from .providers.base import ToolCall, ToolSpec
from .retrieval import Hit, LabIndex, Passage

HintLevel = Literal["nudge", "hint", "walkthrough"]
LEVELS: tuple[HintLevel, ...] = ("nudge", "hint", "walkthrough")

SEARCH_GUIDE = ToolSpec(
    name="search_guide",
    description=(
        "Search this lab's guide and troubleshooting notes. Returns the most relevant passages, each with an id "
        "to cite and a relevance from 0 to 1. Search before answering any question about the lab."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to look for. Rephrase the learner's words if it helps.",
            },
            "k": {
                "type": "integer",
                "minimum": 1,
                "maximum": 6,
                "description": "How many passages, default 4.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)

GET_STEP = ToolSpec(
    name="get_step",
    description="Read one step of the lab guide in full, by its number.",
    parameters={
        "type": "object",
        "properties": {"position": {"type": "integer", "minimum": 1}},
        "required": ["position"],
        "additionalProperties": False,
    },
)

LEARNER_PROGRESS = ToolSpec(
    name="learner_progress",
    description="See which step the learner is on, which steps they have completed and which steps are graded.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
)

GET_HINT = ToolSpec(
    name="get_hint",
    description=(
        "Get the instructor's hint for a step. Levels go from a gentle nudge to a full walkthrough. For graded "
        "steps the walkthrough is only available when the instructor has released solutions; otherwise you get "
        "the strongest hint that is allowed, with allowed set to false."
    ),
    parameters={
        "type": "object",
        "properties": {
            "position": {"type": "integer", "minimum": 1},
            "level": {"type": "string", "enum": list(LEVELS)},
        },
        "required": ["position", "level"],
        "additionalProperties": False,
    },
)


@dataclass(frozen=True)
class ToolOutcome:
    content: str
    ok: bool
    summary: str


@dataclass(frozen=True)
class HintDecision:
    position: int
    requested: HintLevel
    given: HintLevel | None
    allowed: bool


class ToolArgumentError(ValueError):
    pass


@dataclass
class Toolset:
    lab: Lab
    index: LabIndex
    question: str
    current_step: int | None
    completed_steps: list[int]
    retrieved: dict[str, Passage] = field(default_factory=dict)
    relevance: dict[str, float] = field(default_factory=dict)
    hints: list[HintDecision] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)

    def specs(self) -> list[ToolSpec]:
        return [SEARCH_GUIDE, GET_STEP, LEARNER_PROGRESS, GET_HINT]

    @property
    def best_relevance(self) -> float:
        return max(self.relevance.values(), default=0.0)

    def run(self, call: ToolCall) -> ToolOutcome:
        handlers = {
            "search_guide": self._search_guide,
            "get_step": self._get_step,
            "learner_progress": self._learner_progress,
            "get_hint": self._get_hint,
        }
        handler = handlers.get(call.name)
        if handler is None:
            return ToolOutcome(f"Unknown tool {call.name!r}.", ok=False, summary="unknown tool")
        try:
            return handler(call.arguments)
        except ToolArgumentError as error:
            return ToolOutcome(f"Invalid arguments: {error}", ok=False, summary=str(error))

    def _remember(self, passage: Passage, relevance: float) -> None:
        self.retrieved[passage.id] = passage
        self.relevance[passage.id] = max(relevance, self.relevance.get(passage.id, 0.0))

    def _render(self, passage: Passage, relevance: float) -> str:
        text, dropped = screen_retrieved_text(passage.text)
        if dropped:
            self.flags.add("injection_filtered")
        graded = ' graded="true"' if passage.graded else ""
        return (
            f'<passage id="{passage.id}" title="{escape(passage.title)}" relevance="{relevance:.2f}"{graded}>\n'
            f"{text}\n</passage>"
        )

    def _search_guide(self, args: dict[str, Any]) -> ToolOutcome:
        query = _string(args, "query", max_length=500)
        k = _integer(args, "k", default=4, low=1, high=6)
        hits: list[Hit] = self.index.search(query, k)
        if not hits:
            return ToolOutcome("No passages matched. The guide may not cover this.", ok=True, summary="0 passages")
        for hit in hits:
            self._remember(hit.passage, hit.relevance)
        body = "\n".join(self._render(hit.passage, hit.relevance) for hit in hits)
        return ToolOutcome(body, ok=True, summary=f"{len(hits)} passages, best {hits[0].passage.id}")

    def _get_step(self, args: dict[str, Any]) -> ToolOutcome:
        position = _integer(args, "position", low=1, high=100)
        passages = [p for p in self.index.passages if p.kind == "step" and p.step == position]
        if not passages:
            raise ToolArgumentError(f"there is no step {position}; the lab has {len(self.lab.steps)} steps")
        rendered = []
        for passage in passages:
            relevance = self.index.relevance(self.question, passage.id)
            self._remember(passage, relevance)
            rendered.append(self._render(passage, relevance))
        return ToolOutcome("\n".join(rendered), ok=True, summary=f"step {position}")

    def _learner_progress(self, _: dict[str, Any]) -> ToolOutcome:
        payload = {
            "current_step": self.current_step,
            "completed_steps": sorted(set(self.completed_steps)),
            "total_steps": len(self.lab.steps),
            "graded_steps": [s.position for s in self.lab.steps if s.graded],
            "solutions_released": self.lab.solutions_allowed,
        }
        return ToolOutcome(json.dumps(payload), ok=True, summary=f"on step {self.current_step or '?'}")

    def _get_hint(self, args: dict[str, Any]) -> ToolOutcome:
        position = _integer(args, "position", low=1, high=100)
        level = args.get("level")
        if level not in LEVELS:
            raise ToolArgumentError(f"level must be one of {', '.join(LEVELS)}")
        step = self.lab.step(position)
        if step is None:
            raise ToolArgumentError(f"there is no step {position}; the lab has {len(self.lab.steps)} steps")

        allowed = not (level == "walkthrough" and step.graded and not self.lab.solutions_allowed)
        ceiling = LEVELS.index(level) if allowed else LEVELS.index("hint")
        texts = {"nudge": step.hints.nudge, "hint": step.hints.hint, "walkthrough": step.hints.walkthrough}
        given: HintLevel | None = next((lvl for lvl in reversed(LEVELS[: ceiling + 1]) if texts[lvl]), None)
        self.hints.append(HintDecision(position, level, given, allowed))

        first = next(p for p in self.index.passages if p.kind == "step" and p.step == position)
        self._remember(first, max(0.5, self.index.relevance(self.question, first.id)))
        payload: dict[str, Any] = {
            "position": position,
            "step_title": step.title,
            "graded": step.graded,
            "requested_level": level,
            "level": given,
            "allowed": allowed,
            "text": " ".join((texts[given] or "").split()) if given else None,
            "cite": first.id,
        }
        if not allowed:
            payload["note"] = (
                "The instructor has not released solutions for this graded step. Share the hint and say that the "
                "full solution is withheld. Do not work out the commands yourself."
            )
        summary = f"step {position}: {given or 'none'}" + ("" if allowed else " (walkthrough withheld)")
        return ToolOutcome(json.dumps(payload), ok=True, summary=summary)


def _string(args: dict[str, Any], name: str, *, max_length: int) -> str:
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ToolArgumentError(f"{name} must be a non-empty string")
    return value.strip()[:max_length]


def _integer(args: dict[str, Any], name: str, *, default: int | None = None, low: int, high: int) -> int:
    value = args.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int | float) or int(value) != value:
        raise ToolArgumentError(f"{name} must be an integer")
    number = int(value)
    if not low <= number <= high:
        raise ToolArgumentError(f"{name} must be between {low} and {high}")
    return number
