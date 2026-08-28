"""Shared setup for the scripts in this folder. Not a public API - the
top-level `dr_companion.py`, `lich.py` and `streamkit.py` are; this just saves
each script from repeating the same three lines.
"""

from __future__ import annotations

import sys
from pathlib import Path


def bootstrap() -> None:
    """Puts `python/` on `sys.path` so a script run as
    `python python/scripts/whatever.py` can `import dr_companion` without the
    caller having set `PYTHONPATH` themselves. Idempotent and cheap enough to
    call unconditionally at the top of every script here."""
    parent = str(Path(__file__).resolve().parent.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)


bootstrap()
