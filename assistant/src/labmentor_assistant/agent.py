"""One learner turn: the tool loop, then the checks on the answer."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .guardrails import check_citations, find_solution_leak
from .models import AnswerRequest, AnswerResult, Citation, Policy, ToolTrace, Usage
from .prompts import NOT_IN_GUIDE, system_prompt
from .providers.base import AssistantMessage, Message, Provider, ToolResult, UserMessage
from .retrieval import IndexCache
from .tools import Toolset

log = logging.getLogger("labmentor.agent")

Emit = Callable[[str, dict[str, Any]], Awaitable[None]]

ANSWER_THRESHOLD = 0.3
LOW_CONFIDENCE = 0.35


async def _no_emit(_: str, __: dict[str, Any]) -> None:
    return None


async def answer_question(
    request: AnswerRequest,
    provider: Provider,
    indexes: IndexCache,
    *,
    emit: Emit = _no_emit,
    max_rounds: int = 5,
) -> AnswerResult:
    lab = request.lab
    toolset = Toolset(
        lab=lab,
        index=indexes.get(lab),
        question=request.question,
        current_step=request.current_step,
        completed_steps=request.completed_steps,
    )
    system = system_prompt(lab, request.current_step, request.completed_steps)
    messages: list[Message] = [
        UserMessage(t.content) if t.role == "user" else AssistantMessage(t.content) for t in request.history
    ]
    messages.append(UserMessage(request.question))

    usage = Usage()
    traces: list[ToolTrace] = []
    model = provider.model
    text = ""
    started = time.perf_counter()
    for round_number in range(1, max_rounds + 1):
        reply = await provider.complete(system, messages, toolset.specs())
        model = reply.model
        usage.input_tokens += reply.input_tokens
        usage.output_tokens += reply.output_tokens
        if not reply.tool_calls:
            text = reply.text.strip()
            break
        messages.append(AssistantMessage(reply.text, reply.tool_calls))
        for call in reply.tool_calls:
            await emit("tool", {"name": call.name, "status": "running", "round": round_number})
            outcome = toolset.run(call)
            traces.append(ToolTrace(name=call.name, arguments=call.arguments, ok=outcome.ok, summary=outcome.summary))
            await emit(
                "tool",
                {"name": call.name, "status": "done" if outcome.ok else "error", "summary": outcome.summary},
            )
            messages.append(ToolResult(call.id, call.name, outcome.content, is_error=not outcome.ok))
    else:
        toolset.flags.add("max_rounds")
        log.warning("tool loop hit %s rounds for lab %s", max_rounds, lab.slug)

    result = finalize(text, toolset, model=model, usage=usage, traces=traces)
    log.info(
        "answered lab=%s policy=%s confidence=%.2f tools=%d ms=%d",
        lab.slug,
        result.policy,
        result.confidence,
        len(traces),
        (time.perf_counter() - started) * 1000,
    )
    return result


def finalize(text: str, toolset: Toolset, *, model: str, usage: Usage, traces: list[ToolTrace]) -> AnswerResult:
    """Apply the output checks and decide the policy label, confidence and whether an instructor should look."""
    lab = toolset.lab
    flags = set(toolset.flags)

    checked = check_citations(text, toolset.retrieved)
    text, citations = checked.text, checked.citations
    if checked.removed:
        flags.add("citation_removed")

    withheld = any(not h.allowed for h in toolset.hints)
    leaked = find_solution_leak(text, lab)
    if leaked is not None:
        flags.add("solution_redacted")
        withheld = True
        hint = leaked.hints.hint or leaked.hints.nudge
        cite = f"step-{leaked.position}"
        text = (
            f"Step {leaked.position} ({leaked.title}) is a graded checkpoint, so I can't give you the full solution."
            + (f" Here's a hint instead: {' '.join(hint.split())}" if hint else "")
            + (f" [{cite}]" if cite in toolset.retrieved else "")
        )
        citations = (
            [Citation(id=cite, title=toolset.retrieved[cite].title, step=leaked.position)]
            if (cite in toolset.retrieved)
            else []
        )

    best = max((toolset.relevance.get(c.id, 0.0) for c in citations), default=toolset.best_relevance)
    policy: Policy
    if withheld:
        policy = "solution_withheld"
    elif any(h.allowed and h.given in ("nudge", "hint") for h in toolset.hints):
        policy = "hint_only"
    elif (not citations and toolset.best_relevance < ANSWER_THRESHOLD) or not text:
        policy = "not_in_guide"
    else:
        policy = "answered"

    if policy == "not_in_guide":
        text = text if text and not citations and "guide" in text.lower() else NOT_IN_GUIDE
        citations = []
    if policy == "answered" and not citations:
        flags.add("uncited")

    confidence = round(min(1.0, best) * (1.0 if citations else 0.5), 2) if policy != "not_in_guide" else 0.0
    needs_instructor = policy == "not_in_guide" or confidence < LOW_CONFIDENCE
    return AnswerResult(
        answer=text,
        citations=citations,
        policy=policy,
        needs_instructor=needs_instructor,
        confidence=confidence,
        tools=traces,
        model=model,
        usage=usage,
        flags=sorted(flags),
    )
