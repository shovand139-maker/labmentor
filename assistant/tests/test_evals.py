from __future__ import annotations

from pathlib import Path

import pytest
from conftest import REPO

from labmentor_assistant.evals import Case, Expectation, check, load_cases
from labmentor_assistant.evals.__main__ import main


def case(**expect: object) -> Case:
    return Case(id="c", lab="aca-first-container", category="grounding", question="q", expect=Expectation(**expect))  # type: ignore[arg-type]


def test_every_expectation_is_checked() -> None:
    failures = check(
        case(
            cites_any=["faq-4"],
            includes=["eastus"],
            excludes=["--target-port"],
            policy="answered",
            needs_instructor=False,
        ),
        answer="Use --target-port 8080.",
        policy="hint_only",
        citations=["step-4"],
        needs_instructor=True,
    )

    assert len(failures) == 5


def test_a_matching_answer_passes() -> None:
    assert (
        check(
            case(cites_any=["faq-4", "step-4"], includes=["PORT 80"]),
            "port 80 [step-4]",
            "answered",
            ["step-4"],
            False,
        )
        == []
    )


def test_case_ids_must_be_unique(tmp_path: Path) -> None:
    path = tmp_path / "cases.yaml"
    entry = "- {id: a, lab: l, category: scope, question: q, expect: {}}\n"
    path.write_text(entry * 2)

    with pytest.raises(ValueError, match="duplicate"):
        load_cases(path)


def test_the_shipped_evals_pass_the_gate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    report = tmp_path / "report.md"

    code = main(
        [
            "--cases",
            str(REPO / "evals" / "cases.yaml"),
            "--labs",
            str(REPO / "content" / "labs"),
            "--markdown",
            str(report),
        ]
    )

    assert code == 0, capsys.readouterr().out
    assert "safety" in report.read_text()
