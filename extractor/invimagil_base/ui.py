"""Console output in Spanish with timestamps, mirrored to an in-memory log."""
from __future__ import annotations

import datetime as dt


class Console:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def step(self, msg: str) -> None:
        stamp = dt.datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] {msg}"
        print(line, flush=True)
        self.lines.append(line)

    def detail(self, msg: str) -> None:
        print(msg, flush=True)
        self.lines.append(msg)

    def warn(self, msg: str) -> None:
        self.step(f"⚠ {msg}")

    def banner(self, title: str) -> None:
        print("\n" + "=" * 72)
        print(f"  {title}")
        print("=" * 72 + "\n", flush=True)
