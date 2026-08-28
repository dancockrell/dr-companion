"""Chain existing Lich scripts into one workflow, with real decisions between
them - the "wire together lich commands" example.

Genie/Lich users chain scripts today by hand: start one, watch for it to
finish, start the next, remembering the order themselves every session. This
does the remembering: start a training script, wait for either it to say it's
done or a timeout, decide from live vitals whether a heal is needed before
going again, and only force-restart the healer when it actually is - not
every pass.

Names are placeholders - point `--train-script`/`--heal-script` at scripts you
actually have installed. This file is the pattern, not a claim that scripts
called exactly this exist.

    python python/scripts/flow_script_chain.py --train-script my-trainer --heal-script my-healer
    python python/scripts/flow_script_chain.py --train-script my-trainer --heal-script my-healer \\
        --done-pattern "my-trainer.*(?:stops|done)" --health-threshold 60
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import re
import threading

from dr_companion import Companion
from flow import Flow, FlowContext, FlowRunner, Step
from lich import Lich


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--train-script", required=True, help="Lich script name that trains")
    parser.add_argument("--heal-script", required=True, help="Lich script name that heals")
    parser.add_argument(
        "--done-pattern",
        default=None,
        help="regex a line must match for the trainer to be considered finished "
        "(default: '<train-script> ... (?:done|stops|exiting)', case-insensitive)",
    )
    parser.add_argument(
        "--health-threshold",
        type=float,
        default=60.0,
        help="force-restart --heal-script if health drops at or below this percent (default 60)",
    )
    parser.add_argument(
        "--train-timeout",
        type=float,
        default=1200.0,
        help="give up waiting for the trainer to finish after this many seconds (default 1200)",
    )
    args = parser.parse_args()

    done_pattern = args.done_pattern or rf"{re.escape(args.train_script)}.*(?:done|stops|exiting)"
    done_re = re.compile(done_pattern, re.IGNORECASE)

    c = Companion()
    lich = Lich(c)
    runner = FlowRunner(c)

    def heal_if_needed(ctx: FlowContext) -> None:
        pct = ctx.vital_pct("health")
        if pct is not None and pct <= args.health_threshold:
            print(f"flow_script_chain: health at {pct:.0f}% - force-starting '{args.heal_script}'")
            lich.force_start(args.heal_script)
        else:
            print(f"flow_script_chain: health {pct if pct is not None else 'unknown'} - no heal needed")

    rotation = Flow(
        id="rotation",
        title="Train, then heal if needed",
        loops=True,
        steps=[
            Step("Starting the trainer", run=lambda ctx: lich.force_start(args.train_script), wait="settle", settle=1),
            Step(
                "Waiting for the trainer to finish",
                wait="line",
                wait_for=done_re,
                timeout=args.train_timeout,
            ),
            Step("Checking health, healing if needed", run=heal_if_needed, wait="settle", settle=0.5),
        ],
    )

    print(f"flow_script_chain: attached: {c.status()}")
    threading.Thread(target=c.run, daemon=True).start()

    print("flow_script_chain: running - Ctrl+C to stop")
    try:
        runner.run(rotation)
    except KeyboardInterrupt:
        runner.stop()
        print("flow_script_chain: stopped")


if __name__ == "__main__":
    main()
