# Your scripts go here

Anything you save in this folder becomes a task in the app. There is no
registration step and no restart: `runner.ts` re-reads this folder every time
it is asked, and loads your file fresh on every run, so a script you edit and
save runs in its new form the next time you press it.

A file called `hunt_rats.ts` becomes the task `user.hunt_rats`, and runs
either way:

```
node typescript/runner.ts run user.hunt_rats
```

## The shape

The first line of your file's opening `/** ... */` comment becomes the
description the app shows:

```typescript
/**
 * Hunts rats until told to stop.
 */
import { Task, type CleanLine } from '../../drtask.ts'

export function main() {
  return new HuntRats()
}

class HuntRats extends Task {
  override onClean(line: CleanLine): void {
    if (line.text.toLowerCase().includes('you see')) {
      this.do('attack')
    }
  }
}
```

`export function main` is one of three shapes `runner.ts` accepts — a
`main`, a `TASK`, or a `task` — checked in that order. The other kind of
script, one that does its work at the top level instead of exporting
anything, is just as valid: `tasks/watch.ts` (the one built-in task) is
written that way, ending in `await watch.run()`.

There is no `Flow`/`Step` engine here yet the way Python has one — see
`../../README.md`'s own note on that. A TypeScript task reacts to game text
and vitals directly, by overriding `Task`'s hooks (`onClean`, `onVitals`,
`onStart`), which is more code than a condition-and-step Python flow for the
same job but not a different way of thinking about it: `onClean` fires per
line, exactly like `on_clean` does in Python.

**A vital the game has not reported is not zero.** `vitals.health?.percent`
is `NaN` until a health bar arrives, so a comparison against it is `false` in
both directions and your task does nothing rather than acting on a number
nobody sent. See `Vital.percent`'s own comment in `../../drtask.ts` for why
that is the safe default, not a bug.

## What you cannot do

Send commands faster than 40 a minute. That cap is enforced in `do()` and a
script cannot raise it. Hitting it throws `RateLimited` and stops the task,
because a script that silently throttles is one whose author never finds out
their loop is broken.

Pause and Stop in the app reach your script too: Pause holds its commands at
the socket, Stop ends the process. Starting either a Python task or a
TypeScript one stops whichever of the two was already running — at most one
task runs at a time, regardless of which language it's written in.

## Ruby

Ruby scripts are Lich scripts and live in Lich's own `scripts` folder, not
here. The app's Scripts tab writes them to the right place; they run inside
Lich with Lich's API, and start the same way any other Lich script does.

## Worth copying

`../watch.ts` shows the shape of a real task: overriding `onStart`,
`onVitals` and `onClean`, and reading `roundtimeUntil` directly rather than
waiting on it, since a read-only task never calls `do()`.
