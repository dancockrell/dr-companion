# 3D is cancelled

**Dan, 9 September 2026:** remove all 3D and all 3D workflows and mention of
them everywhere. They are toxic to the agents.

Three documents used to live here and are deleted:

- `CLAUDE_3D_VIEWER_BRIEF.md`
- `THREE_D_REBUILD_HANDOFF.md` (743 lines, headed "approved direction; ready
  for parallel implementation")
- `THREE_D_WORLD_STRATEGY.md` (561 lines, headed "approved replacement
  direction")

They were deleted because they read as live direction. A session opening one
of them found an approved plan and started building against it, long after
the decision had reversed. The documents kept producing the behaviour after
the direction was gone.

## What this means for work in this repo

Do not propose, plan, scaffold, or restore a 3D viewer, a 3D asset pipeline,
a model library, rigging, meshes, or any engine feature that exists to render
3D. If you find a surviving 3D reference in a doc, brief, plan or comment,
delete it and say so in your commit. A surviving 3D document is not evidence
that this decision lapsed.

## Isometric is not the same thing as 3D

The endorsed art direction is the **2D isometric form** originated in the
weird-western game (`cattle-trail`). Dan's reason is not the look. It is that
an image generator can produce that form consistently, manipulate it well,
and increasingly repair its own mistakes. Consistency under generation is the
selection criterion.

So "isometric" in this repo means 2D sprite art in an isometric projection.
It does not license 3D models, rigging, or a 3D scene graph.
