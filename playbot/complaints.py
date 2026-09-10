"""What the bot noticed, in a shape that can be acted on.

A complaint is not "this looked wrong". It carries the room it happened in,
the evidence on both sides, and what the bot expected instead - because a
report without its evidence costs whoever reads it a full re-investigation,
and half of them turn out to be the bot's own instrument misreading.

Severity is about the player, not the code. `blocking` means a person could
not continue. `wrong` means the game said one thing and the client showed
another. `thin` means it worked and told the player nothing useful.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import asdict, dataclass, field

SEVERITIES = ('blocking', 'wrong', 'thin', 'note')


@dataclass
class Complaint:
    severity: str
    subject: str                 # what it is about: 'scene', 'client', 'game', 'bot'
    summary: str                 # one sentence, the claim itself
    room_id: int | None = None
    room_title: str | None = None
    expected: str | None = None
    observed: str | None = None
    evidence: dict = field(default_factory=dict)
    mission: str | None = None

    def __post_init__(self) -> None:
        if self.severity not in SEVERITIES:
            raise ValueError(f'unknown severity {self.severity!r}, expected one of {SEVERITIES}')


class Sink:
    """Collects complaints and writes them where they can be read in bulk.

    Deduplicated on the claim rather than the room: one lexicon gap that
    misreads 4,000 rooms is one problem, and filing it 4,000 times buries the
    other nineteen. The count travels with it so the scale is not lost.
    """

    def __init__(self, path: str | None = None) -> None:
        self.path = pathlib.Path(path) if path else None
        self._by_claim: dict[tuple, Complaint] = {}
        self._counts: dict[tuple, int] = {}
        self._examples: dict[tuple, list[int]] = {}

    def file(self, complaint: Complaint) -> None:
        key = (complaint.subject, complaint.severity, complaint.summary)
        if key not in self._by_claim:
            self._by_claim[key] = complaint
            self._counts[key] = 0
            self._examples[key] = []
        self._counts[key] += 1
        if complaint.room_id is not None and len(self._examples[key]) < 5:
            self._examples[key].append(complaint.room_id)

    def all(self) -> list[tuple[Complaint, int, list[int]]]:
        order = {s: i for i, s in enumerate(SEVERITIES)}
        keys = sorted(
            self._by_claim,
            key=lambda k: (order[self._by_claim[k].severity], -self._counts[k]),
        )
        return [(self._by_claim[k], self._counts[k], self._examples[k]) for k in keys]

    def report(self) -> str:
        rows = self.all()
        if not rows:
            return 'no complaints — which is either good news or a bot that saw nothing'
        lines = [f'{sum(c for _, c, _ in rows):,} complaints, {len(rows)} distinct:', '']
        for complaint, count, examples in rows:
            lines.append(f'  [{complaint.severity:<8}] {complaint.subject:<7} x{count:<6,} {complaint.summary}')
            if complaint.expected:
                lines.append(f'             expected: {complaint.expected}')
            if complaint.observed:
                lines.append(f'             observed: {complaint.observed}')
            if examples:
                lines.append(f'             rooms: {", ".join(f"#{r}" for r in examples)}')
            lines.append('')
        return '\n'.join(lines)

    def flush(self) -> int:
        if not self.path:
            return 0
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open('w', encoding='utf-8') as handle:
            for complaint, count, examples in self.all():
                record = asdict(complaint)
                record['count'] = count
                record['example_rooms'] = examples
                handle.write(json.dumps(record) + '\n')
        return len(self._by_claim)
