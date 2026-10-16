"""Request and response contract between the web app and the assistant.

Field names are snake_case on the wire. The web app sends a lab it has already authorized for the
caller, so this service never reads tenant data on its own.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Hints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nudge: str | None = Field(default=None, max_length=2_000)
    hint: str | None = Field(default=None, max_length=2_000)
    walkthrough: str | None = Field(default=None, max_length=4_000)


class LabStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: int = Field(ge=1, le=100)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20_000)
    graded: bool = False
    hints: Hints = Field(default_factory=Hints)
    solution: list[str] = Field(default_factory=list, max_length=10)


class FaqEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=4_000)


class Lab(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,59}$")
    title: str = Field(min_length=1, max_length=200)
    solutions_allowed: bool = False
    steps: list[LabStep] = Field(min_length=1, max_length=50)
    faq: list[FaqEntry] = Field(default_factory=list, max_length=100)

    def step(self, position: int) -> LabStep | None:
        return next((s for s in self.steps if s.position == position), None)


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8_000)


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lab: Lab
    question: str = Field(min_length=1, max_length=2_000)
    current_step: int | None = Field(default=None, ge=1, le=100)
    completed_steps: list[int] = Field(default_factory=list, max_length=100)
    history: list[Turn] = Field(default_factory=list, max_length=20)


Policy = Literal["answered", "hint_only", "solution_withheld", "not_in_guide"]


class Citation(BaseModel):
    id: str
    title: str
    step: int | None


class ToolTrace(BaseModel):
    name: str
    arguments: dict[str, Any]
    ok: bool
    summary: str


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class AnswerResult(BaseModel):
    answer: str
    citations: list[Citation]
    policy: Policy
    needs_instructor: bool
    confidence: float = Field(ge=0, le=1)
    tools: list[ToolTrace]
    model: str
    usage: Usage
    flags: list[str] = Field(default_factory=list)
