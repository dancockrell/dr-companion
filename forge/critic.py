"""Ask a model about the clusters a rule cannot settle - or say plainly that it did not.

Some clusters are not a lexicon defect. "1,612 rooms name a building and never
say whether you are inside it or looking at it from the street" is not a
missing word; #19 is a temple seen across a courtyard and #137 is a tunnel,
and no term either of them contains separates the two. A reader has to read
them. This is that reader, when one is available.

What it may and may not do is the whole design:

**It proposes, it never rules.** Output goes to a proposals file that a person
turns into a ruling. A critic that wrote `rulings.json` itself would be a
model quietly changing the parser with nobody in the loop, and its mistakes
would enter the corpus wearing the same clothes as a measured decision.

**It answers in three states, never two.** `inside`, `outside`, and *I cannot
tell from this text* - and the third is a real answer that gets recorded, not
a failure to be retried until it picks a side. Folding "cannot tell" into a
guess is precisely the invented default this pipeline exists to refuse, and a
model asked a forced-choice question will always invent one.

**When it cannot run, it says so and stops.** There are three separate ways
this is unavailable - no SDK installed, no credential, or the call failed -
and they are reported as three different things rather than one shrug,
because they have three different fixes. Every room it did not adjudicate is
reported as `not adjudicated`, and *never* as anything else. A critic that
degrades into guessing is worse than no critic, because the guesses are
indistinguishable from readings.

No key is ever read into a variable here, printed, or written anywhere. The
SDK reads the environment itself; this module only ever asks whether a
credential exists, and gets back a boolean.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from dataclasses import dataclass, field

MODEL = 'claude-opus-5'

# The three states. Named rather than boolean, because the third is the one
# that carries the design and a bool cannot express it.
DECIDED = 'decided'
CANNOT_TELL = 'cannot tell from the text'
NOT_ADJUDICATED = 'not adjudicated'


@dataclass
class Availability:
    ready: bool
    reason: str


def availability() -> Availability:
    """Can this run at all, and if not, exactly which thing is missing?

    Checked in the order a person would fix them. An unset ANTHROPIC_API_KEY
    is not on its own proof that there is no credential - the SDK also reads a
    profile written by `ant auth login` - so the credential question is asked
    of the SDK's own resolution rather than of the environment, and the answer
    here distinguishes "no key in the environment" from "no credential at all".
    """
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return Availability(False, 'the anthropic SDK is not installed in this '
                                   'interpreter (pip install anthropic)')

    if os.environ.get('ANTHROPIC_API_KEY'):
        return Availability(True, 'ANTHROPIC_API_KEY is set in the environment')

    # No env key. The SDK may still resolve a stored profile; constructing a
    # client is the cheapest honest way to ask, and it makes no network call.
    try:
        import anthropic
        anthropic.Anthropic()
    except Exception as exc:  # noqa: BLE001 - the SDK raises its own types
        return Availability(False, f'no credential the SDK could resolve '
                                   f'({type(exc).__name__}); set '
                                   f'ANTHROPIC_API_KEY or run `ant auth login`')
    return Availability(True, 'a stored credential resolved without an env key')


@dataclass
class Proposal:
    cluster_key: str
    state: str
    verdict: str | None = None
    why: str = ''
    rooms: int = 0
    per_room: list[dict] = field(default_factory=list)


# The question, written so that "I cannot tell" is an ordinary answer rather
# than an admission of failure. A prompt that asks a model to classify without
# offering that door gets a classification every time, including for the rooms
# whose text genuinely does not say.
PROMPT = """You are reading room descriptions from the text MUD DragonRealms, to
decide one thing about each: is the speaker standing INSIDE an enclosed
structure, OUTSIDE under the open sky, in a natural CAVE, or UNDERGROUND in a
built or dug passage?

Rules you must follow exactly:

1. Decide from the description text alone. You will not be shown the room's
   title or its zone, and you must not infer from a proper noun what kind of
   place it is.
2. If the text does not settle it, answer "cannot tell". That is a correct and
   expected answer, not a failure. Many of these rooms genuinely do not say.
   Do not pick the more likely option; pick "cannot tell".
3. Quote the words you decided on. If you cannot quote a phrase from the text
   that settles it, the answer is "cannot tell".

Answer as JSON only, an array with one object per room:
  {"room_id": <int>, "verdict": "interior"|"outdoor"|"cave"|"underground"|"cannot tell",
   "quote": "<the words you decided on, or empty>", "why": "<one sentence>"}
"""

SCHEMA = {
    'type': 'object',
    'properties': {
        'rooms': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'room_id': {'type': 'integer'},
                    'verdict': {'type': 'string',
                                'enum': ['interior', 'outdoor', 'cave',
                                         'underground', 'cannot tell']},
                    'quote': {'type': 'string'},
                    'why': {'type': 'string'},
                },
                'required': ['room_id', 'verdict', 'quote', 'why'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['rooms'],
    'additionalProperties': False,
}


def review(cluster: dict, ready: Availability) -> Proposal:
    """Ask about one cluster's sampled rooms, or report that nothing was asked."""
    samples = cluster.get('samples') or []
    if not ready.ready:
        return Proposal(cluster_key=cluster['key'], state=NOT_ADJUDICATED,
                        why=ready.reason, rooms=len(samples))
    if not samples:
        return Proposal(cluster_key=cluster['key'], state=NOT_ADJUDICATED,
                        why='the cluster carries no sample rooms to read',
                        rooms=0)

    import anthropic

    body = '\n\n'.join(
        f'room_id {s["room_id"]}:\n{s["description"]}' for s in samples)
    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={'type': 'adaptive'},
            output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
            messages=[{'role': 'user', 'content': f'{PROMPT}\n\n{body}'}],
        )
        # A refusal is an ordinary outcome and must not be read as content.
        if getattr(response, 'stop_reason', None) == 'refusal':
            return Proposal(cluster_key=cluster['key'], state=NOT_ADJUDICATED,
                            why='the model declined this request',
                            rooms=len(samples))
        text = next(b.text for b in response.content if b.type == 'text')
        answers = json.loads(text)['rooms']
    except Exception as exc:  # noqa: BLE001 - any failure means NOT adjudicated
        return Proposal(cluster_key=cluster['key'], state=NOT_ADJUDICATED,
                        why=f'the call failed: {type(exc).__name__}: {exc}',
                        rooms=len(samples))

    decided = [a for a in answers if a['verdict'] != 'cannot tell' and a['quote']]
    # A verdict with no quote behind it is exactly the invention this is
    # guarding against, so it is dropped rather than trusted - and the drop is
    # visible in the counts below.
    if not decided:
        return Proposal(cluster_key=cluster['key'], state=CANNOT_TELL,
                        why='no sampled room could be settled from its own words',
                        rooms=len(samples), per_room=answers)

    verdicts = {a['verdict'] for a in decided}
    if len(verdicts) == 1 and len(decided) == len(answers):
        return Proposal(
            cluster_key=cluster['key'], state=DECIDED, verdict=decided[0]['verdict'],
            why=f'all {len(decided)} sampled rooms read the same way, each with '
                f'a quote from its own text',
            rooms=len(samples), per_room=answers)

    # A split cluster is a real finding: it means the clustering grouped rooms
    # that do not share an answer, and a single ruling over it would be wrong.
    return Proposal(
        cluster_key=cluster['key'], state=CANNOT_TELL,
        why=f'the sampled rooms do not agree ({sorted(verdicts)}), so this '
            f'cluster cannot take one ruling; it needs splitting or per-room '
            f'overrides',
        rooms=len(samples), per_room=answers)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clusters', default='out/clusters.json',
                        help='the file forge.escalate --out wrote')
    parser.add_argument('--out', default='out/proposals.json',
                        help='where to write proposals (never rulings.json)')
    parser.add_argument('--top', type=int, default=10,
                        help='review the N largest clusters')
    parser.add_argument('--min-rooms', type=int, default=10,
                        help='skip clusters smaller than this')
    args = parser.parse_args(argv)

    path = pathlib.Path(args.clusters)
    if not path.exists():
        print(f'REFUSING TO RUN: {path} does not exist. '
              f'Run `python -m forge.escalate --out {path}` first.')
        return 2
    clusters = json.loads(path.read_text(encoding='utf-8'))['clusters']
    picked = [c for c in clusters if c['rooms'] >= args.min_rooms][: args.top]
    if not picked:
        print(f'REFUSING TO REPORT: no cluster has {args.min_rooms}+ rooms, so '
              f'there was nothing to review and a clean run would mean nothing')
        return 2

    ready = availability()
    print(f'critic: {"ready" if ready.ready else "NOT AVAILABLE"} - {ready.reason}')
    if not ready.ready:
        print('every cluster below will be reported as not adjudicated, '
              'which is the honest result and not a failure')
    print()

    proposals = [review(cluster, ready) for cluster in picked]

    counts = {DECIDED: 0, CANNOT_TELL: 0, NOT_ADJUDICATED: 0}
    for proposal in proposals:
        counts[proposal.state] += 1
        print(f'  {proposal.state:<24} {proposal.cluster_key}')
        print(f'      {proposal.why}')
        if proposal.verdict:
            print(f'      proposed verdict: {proposal.verdict}')

    print()
    print(f'{len(proposals)} clusters reviewed: '
          f'{counts[DECIDED]} decided, {counts[CANNOT_TELL]} could not be told '
          f'from the text, {counts[NOT_ADJUDICATED]} not adjudicated')

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        'model': MODEL if ready.ready else None,
        'available': ready.ready,
        'reason': ready.reason,
        'note': 'proposals only. Nothing here is in force until a person '
                'copies it into forge/rulings.json with evidence.',
        'proposals': [
            {
                'cluster': p.cluster_key, 'state': p.state, 'verdict': p.verdict,
                'why': p.why, 'rooms': p.rooms, 'per_room': p.per_room,
            }
            for p in proposals
        ],
    }, indent=2), encoding='utf-8')
    print(f'proposals -> {out}  (proposals, not rulings)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
