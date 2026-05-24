#!/usr/bin/env python3
"""Static checks for the Finance starter-pack memory scaffold."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REFERENCE_COLLECTIONS = {"reports", "statements"}
STALE_PATTERNS = [
    "finance/rules.md",
    "../rules.md",
    "budgeting/",
    "run-budget",
    "finance/budget.md",
]
GENERATED_OR_EXTERNAL_REFERENCES = {
    "latest.md",
    "reports/latest.md",
    "../reports/latest.md",
    "monthly-YYYY-MM.md",
    "reports/monthly-YYYY-MM.md",
    "monthly-2026-05.md",
    "quarterly-2026-Q1.md",
    "annual-2026.md",
    "net-worth-latest.md",
    "me/profile.md",
    "documents/projects.json",
}


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def markdown_files(root: Path) -> list[Path]:
    return sorted(root.rglob("*.md"))


def contains_all(path: Path, needles: list[str]) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [needle for needle in needles if needle not in text]


def extract_path_references(text: str) -> set[str]:
    refs: set[str] = set()
    for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", text):
        refs.add(match.group(1).strip())
    for match in re.finditer(r"`([^`]+)`", text):
        value = match.group(1).strip()
        if value.endswith(".md") or value.endswith(".json") or "/" in value:
            refs.add(value)
    return refs


def should_check_reference(reference: str) -> bool:
    if reference.startswith(("http://", "https://", "#")):
        return False
    if reference in GENERATED_OR_EXTERNAL_REFERENCES:
        return False
    if reference.endswith("/"):
        return False
    if "<" in reference or ">" in reference:
        return False
    if any(token in reference for token in [" ", "YYYY", "<period>", "e.g."]):
        return False
    return reference.startswith(("./", "../")) or "/" in reference


def resolve_reference(source: Path, reference: str) -> Path:
    return (source.parent / reference).resolve()


def check_finance_scaffold(finance_root: Path) -> list[str]:
    failures: list[str] = []
    if not finance_root.is_dir():
        return [f"Finance directory does not exist: {finance_root}"]

    for child in sorted(finance_root.iterdir()):
        if not child.is_dir() or child.name in REFERENCE_COLLECTIONS:
            continue
        if not (child / "AGENT.md").is_file():
            failures.append(f"App directory missing AGENT.md: {rel(child, finance_root)}")
        state_artifact = child / f"{child.name}.md"
        if not state_artifact.is_file():
            failures.append(f"App directory missing state artifact: {rel(state_artifact, finance_root)}")

    artifact_paths = [finance_root / "spec.md", finance_root / "plan.md"]
    for child in sorted(finance_root.iterdir()):
        if child.is_dir() and child.name not in REFERENCE_COLLECTIONS:
            artifact_paths.append(child / f"{child.name}.md")

    for artifact in artifact_paths:
        if not artifact.is_file():
            failures.append(f"Missing artifact: {rel(artifact, finance_root)}")
            continue
        missing = contains_all(artifact, ["**Status:", "Last updated:", "## Changelog"])
        for needle in missing:
            failures.append(f"{rel(artifact, finance_root)} missing `{needle}`")

    for required in [finance_root / "statements" / "README.md", finance_root / "reports" / "README.md"]:
        if not required.is_file():
            failures.append(f"Missing reference folder contract: {rel(required, finance_root)}")

    if (finance_root / "budget.md").exists():
        failures.append("Stale root budget artifact exists: budget.md")
    if (finance_root / "rules.md").exists():
        failures.append("Stale root rules file exists: rules.md")
    if (finance_root / "budgeting").exists():
        failures.append("Stale budgeting/ directory exists")

    for path in markdown_files(finance_root):
        text = path.read_text(encoding="utf-8")
        for pattern in STALE_PATTERNS:
            if pattern in text:
                failures.append(f"{rel(path, finance_root)} contains stale reference `{pattern}`")
        if "memory_edit" in text:
            failures.append(f"{rel(path, finance_root)} contains owner-facing `memory_edit`")
        for reference in sorted(extract_path_references(text)):
            if not should_check_reference(reference):
                continue
            if not resolve_reference(path, reference).exists():
                failures.append(f"{rel(path, finance_root)} references missing path `{reference}`")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("finance_dir", type=Path, help="Path to projects/templates/finance or generated documents/finance")
    args = parser.parse_args()

    failures = check_finance_scaffold(args.finance_dir.resolve())
    if failures:
        print("Finance starter-pack audit failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(f"Finance starter-pack audit passed: {args.finance_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
