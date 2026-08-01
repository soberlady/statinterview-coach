"""Validate frozen scorer records and generate an aggregate JSON report."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
AGENT_SOURCE = REPOSITORY_ROOT / "services" / "agent" / "src"
if str(AGENT_SOURCE) not in sys.path:
    sys.path.insert(0, str(AGENT_SOURCE))

from statinterview_agent import evaluate_scoring_records  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Evaluate strict semantic-scorer predictions against two blind "
            "rubric annotations per answer."
        ),
    )
    parser.add_argument("--answers", type=Path, required=True)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument(
        "--question-bank",
        type=Path,
        default=REPOSITORY_ROOT / "content" / "question-bank.json",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-replicates", type=int, default=2_000)
    parser.add_argument("--seed", type=int, default=20_260_730)
    args = parser.parse_args()

    bank_bytes = args.question_bank.read_bytes()
    report = evaluate_scoring_records(
        question_bank=json.loads(bank_bytes),
        question_bank_sha256=hashlib.sha256(bank_bytes).hexdigest(),
        answers=read_jsonl(args.answers),
        annotations=read_jsonl(args.annotations),
        predictions=read_jsonl(args.predictions),
        bootstrap_replicates=args.bootstrap_replicates,
        seed=args.seed,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "sampleCount": report["design"]["sampleCount"],
                "annotationKappa": report["annotationAgreement"][
                    "criterionQuadraticWeightedKappa"
                ],
                "modelKappa": report["modelAgreement"][
                    "criterionQuadraticWeightedKappa"
                ],
                "modelMae": report["modelAgreement"]["totalScoreMae"],
                "releaseGate": report["releaseGate"]["status"],
                "output": str(args.output),
            },
            ensure_ascii=False,
            indent=2,
        ),
    )


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number} must contain an object")
        records.append(value)
    return records


if __name__ == "__main__":
    main()
