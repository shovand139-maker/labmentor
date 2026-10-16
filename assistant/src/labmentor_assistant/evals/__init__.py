"""Evaluation of answers against a fixed question set.

Every case states what a good answer must do: which passages it cites, which phrases it contains, what it must
never contain, and which policy applies. Safety cases (solution leaks, prompt injection) must all pass; the
rest must pass at the configured rate. CI runs this with the offline provider on every change.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from ..agent import answer_question
from ..models import AnswerRequest, Lab, Policy
from ..providers.base import Provider
from ..retrieval import IndexCache

Category = Literal["grounding", "safety", "scope"]


class Expectation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cites_any: list[str] = Field(default_factory=list)
    includes: list[str] = Field(default_factory=list)
    excludes: list[str] = Field(default_factory=list)
    policy: Policy | None = None
    needs_instructor: bool | None = None


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    lab: str
    category: Category
    question: str
    current_step: int | None = None
    completed_steps: list[int] = Field(default_factory=list)
    solutions_allowed: bool = False
    expect: Expectation


@dataclass
class CaseResult:
    id: str
    category: str
    passed: bool
    failures: list[str]
    answer: str
    policy: str
    citations: list[str]
    confidence: float


@dataclass
class Report:
    provider: str
    model: str
    results: list[CaseResult] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        return sum(r.passed for r in self.results) / len(self.results) if self.results else 0.0

    @property
    def safety_failures(self) -> list[CaseResult]:
        return [r for r in self.results if r.category == "safety" and not r.passed]

    def by_category(self) -> dict[str, tuple[int, int]]:
        totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for r in self.results:
            totals[r.category][0] += r.passed
            totals[r.category][1] += 1
        return {k: (v[0], v[1]) for k, v in sorted(totals.items())}

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "pass_rate": round(self.pass_rate, 4),
            "by_category": {k: {"passed": p, "total": t} for k, (p, t) in self.by_category().items()},
            "results": [asdict(r) for r in self.results],
        }

    def to_markdown(self, min_pass_rate: float) -> str:
        lines = [
            f"### Assistant evals: {sum(r.passed for r in self.results)}/{len(self.results)} passed "
            f"({self.pass_rate:.0%}, gate {min_pass_rate:.0%}, safety must be 100%)",
            "",
            f"Provider `{self.provider}`, model `{self.model}`.",
            "",
            "| Category | Passed |",
            "|---|---|",
        ]
        lines += [f"| {k} | {p}/{t} |" for k, (p, t) in self.by_category().items()]
        failed = [r for r in self.results if not r.passed]
        if failed:
            lines += ["", "#### Failures", ""]
            for r in failed:
                lines.append(f"- **{r.id}** ({r.category}): {'; '.join(r.failures)}")
                lines.append(f"  - answer: {r.answer[:300]}")
        return "\n".join(lines) + "\n"


def load_cases(path: Path) -> list[Case]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    cases = [Case.model_validate(item) for item in raw]
    ids = [c.id for c in cases]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise ValueError(f"duplicate case ids: {', '.join(sorted(duplicates))}")
    return cases


def check(case: Case, answer: str, policy: str, citations: list[str], needs_instructor: bool) -> list[str]:
    failures: list[str] = []
    lowered = answer.lower()
    e = case.expect
    if e.cites_any and not set(e.cites_any) & set(citations):
        failures.append(f"expected a citation of {' or '.join(e.cites_any)}, got {', '.join(citations) or 'none'}")
    failures += [f"missing {phrase!r}" for phrase in e.includes if phrase.lower() not in lowered]
    failures += [f"must not contain {phrase!r}" for phrase in e.excludes if phrase.lower() in lowered]
    if e.policy is not None and policy != e.policy:
        failures.append(f"policy {policy}, expected {e.policy}")
    if e.needs_instructor is not None and needs_instructor != e.needs_instructor:
        failures.append(f"needs_instructor {needs_instructor}, expected {e.needs_instructor}")
    return failures


async def run_evals(cases: list[Case], labs: dict[str, Lab], provider: Provider) -> Report:
    indexes = IndexCache()
    report = Report(provider=provider.name, model=provider.model)
    for case in cases:
        lab = labs.get(case.lab)
        if lab is None:
            raise ValueError(f"case {case.id} refers to unknown lab {case.lab}")
        request = AnswerRequest(
            lab=lab.model_copy(update={"solutions_allowed": case.solutions_allowed}),
            question=case.question,
            current_step=case.current_step,
            completed_steps=case.completed_steps,
        )
        result = await answer_question(request, provider, indexes)
        cited = [c.id for c in result.citations]
        failures = check(case, result.answer, result.policy, cited, result.needs_instructor)
        report.results.append(
            CaseResult(
                id=case.id,
                category=case.category,
                passed=not failures,
                failures=failures,
                answer=result.answer,
                policy=result.policy,
                citations=cited,
                confidence=result.confidence,
            )
        )
    return report
