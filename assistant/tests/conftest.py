from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import pytest

from labmentor_assistant.content import load_lab, load_labs
from labmentor_assistant.models import Lab
from labmentor_assistant.providers.base import Message, ModelReply, ToolSpec

REPO = Path(__file__).resolve().parents[2]
LABS = REPO / "content" / "labs"


@pytest.fixture(scope="session")
def labs() -> dict[str, Lab]:
    return load_labs(LABS)


@pytest.fixture
def aca() -> Lab:
    return load_lab(LABS / "aca-first-container.yaml")


class ScriptedProvider:
    """Replays a fixed list of replies and records what it was sent."""

    name = "scripted"
    model = "scripted-1"

    def __init__(self, replies: list[ModelReply]) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, list[Message], list[str]]] = []

    async def complete(self, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec]) -> ModelReply:
        self.calls.append((system, list(messages), [t.name for t in tools]))
        if not self.replies:
            raise AssertionError("the agent asked for more replies than the test scripted")
        return self.replies.pop(0)
