# Fixture: the instructions N6 retired

Not documentation. This file exists so that section L of
`tools/doc-claims-test.mjs` has something its scanner must catch, and it is
the only file in the repository whose *purpose* is to contain these strings.

Without it, a green "no shipped string instructs the retired route" is equally
what a broken `String.prototype.includes`, a truncated file walk, or a needle
list somebody emptied would produce. It is the positive control, and it is read
through the same `scan()` the real check uses rather than a second copy of the
matcher — a control that re-implements the thing it is controlling proves only
that two pieces of code agree.

One needle per line, on purpose: the control also asserts that the reported
line numbers are distinct, which a broken line splitter could not manage.

Type these at nobody. They describe a route this app no longer takes; see
`docs/LICH_NATIVE_LOGIN.md`.

    #lichconnect PhemiusDR
    #config licharguments --dragonrealms
    #config lichpath C:/Ruby4Lich5/Lich5/lich.rbw
    ruby lich.rbw --dragonrealms --genie
    ,companion_bridge

If a needle is added to `RETIRED_INSTRUCTIONS` and not added here, the control
fails rather than passing quietly, because it asserts one hit per needle.
