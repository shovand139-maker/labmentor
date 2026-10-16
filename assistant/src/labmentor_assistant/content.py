"""Read lab definitions from content/labs/*.yaml, the same files the web app seeds its database from."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .models import Lab


def load_lab(path: Path, *, solutions_allowed: bool = False) -> Lab:
    raw: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    steps = [
        {
            "position": i,
            "title": step["title"],
            "body": step["body"],
            "graded": bool(step.get("graded", False)),
            "hints": step.get("hints") or {},
            "solution": step.get("solution") or [],
        }
        for i, step in enumerate(raw["steps"], start=1)
    ]
    return Lab.model_validate(
        {
            "slug": raw["slug"],
            "title": raw["title"],
            "solutions_allowed": solutions_allowed,
            "steps": steps,
            "faq": raw.get("faq") or [],
        }
    )


def load_labs(directory: Path) -> dict[str, Lab]:
    labs = [load_lab(p) for p in sorted(directory.glob("*.yaml"))]
    return {lab.slug: lab for lab in labs}
