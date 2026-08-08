"""Build a deterministic voice-quality report from frozen JSONL samples."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from statinterview_agent.voice_evaluation import evaluate_voice_samples


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    records = [
        json.loads(line)
        for line in args.samples.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    report = evaluate_voice_samples(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["releaseGate"], ensure_ascii=False))


if __name__ == "__main__":
    main()
