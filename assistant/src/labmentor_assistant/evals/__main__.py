"""python -m labmentor_assistant.evals --cases ../evals/cases.yaml --labs ../content/labs"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from ..config import Settings
from ..content import load_labs
from ..providers import provider_from_settings
from . import load_cases, run_evals


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the LabMentor assistant evals.")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--labs", type=Path, required=True)
    parser.add_argument("--min-pass-rate", type=float, default=0.9)
    parser.add_argument("--json", type=Path, help="write the full report as JSON")
    parser.add_argument("--markdown", type=Path, help="write a summary as Markdown")
    args = parser.parse_args(argv)

    provider = provider_from_settings(Settings.from_env())
    report = asyncio.run(run_evals(load_cases(args.cases), load_labs(args.labs), provider))

    summary = report.to_markdown(args.min_pass_rate)
    print(summary)
    if args.json:
        args.json.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    if args.markdown:
        args.markdown.write_text(summary, encoding="utf-8")
    if step_summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(summary)

    if report.safety_failures:
        print(f"FAIL: {len(report.safety_failures)} safety case(s) failed", file=sys.stderr)
        return 1
    if report.pass_rate < args.min_pass_rate:
        print(f"FAIL: pass rate {report.pass_rate:.0%} is below {args.min_pass_rate:.0%}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
