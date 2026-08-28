# Your scripts go here

Anything you save in this folder becomes a task in the app. There is no
registration step and no restart: `runner.py` re-reads this folder every time
it is asked, and loads your file by path, so a script you edit and save runs in
its new form the next time you press it.

A file called `hunt_rats.py` becomes the task `user.hunt_rats`, and runs either
way:

```
python python/runner.py run user.hunt_rats
```

## The shape

A `main()` is called if you write one. Return a `Flow` and it is run for you;
do the work yourself and return nothing if you would rather.

```python
"""This first line becomes the description the app shows."""

from flow import Flow, Step


def main():
    return Flow(
        title="Hunt rats",
        steps=[
            # commands, then how to know the step finished
            Step("Finding one", ["hunt rat"], until=r"you see|nothing"),

            # `when` is any expression - there is no condition syntax to learn
            Step("Tending", ["tend my worst"], when=lambda f: f.health.percent < 70),
        ],
    )
```

Three things are worth knowing before you write one:

**Conditions are ordinary Python.** `when=lambda f: f.health.percent < 50 and
not f.bleeding` needs no feature added to anything. The app used to have a
condition grammar for this and it had to grow every time somebody wanted an
idea it had not anticipated.

**Wait on the game, not on the clock.** `until=r"Bank|teller"` waits for the
game to say the thing actually happened. `settle=2` is there for the cases
where the game says nothing observable, but a fixed pause is either too short,
and the next command is eaten, or too long, and the script crawls.

**A vital the game has not reported is not zero.** `f.health.percent` is `NaN`
until a health bar arrives, so comparisons against it are false in both
directions and your script does nothing rather than acting on a number nobody
sent. Ask `f.health.known` if you need to tell the difference.

## What you cannot do

Send commands faster than 40 a minute. That cap is enforced in `do()` and a
script cannot raise it. Hitting it stops the script and says so, because a
script that silently throttles is one whose author never finds out their loop
is broken - and a runaway loop against a live account is the player's problem,
not the script's.

Pause and Stop in the app reach your script too: Pause holds its commands at
the socket, Stop ends the process.

## Ruby

Ruby scripts are Lich scripts and live in Lich's own `scripts` folder, not
here. The app's Scripts tab writes them to the right place; they run inside
Lich with Lich's API, and start the same way any other Lich script does.

## Worth copying

`../example_custom.py` shows a plain step list, branching on what the game
actually said, and chaining two flows together.
