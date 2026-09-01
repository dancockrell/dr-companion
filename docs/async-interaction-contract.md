# Asynchronous interaction contract

Every user-visible asynchronous resource distinguishes `idle`, `loading`, `ready`, `empty`, `error`, and `stale`. Empty is a successful answer, never the fallback for rejection. Stale means old confirmed data remains visible while refresh failed; its error and retry remain visible too.

Every user-initiated action distinguishes `idle`, `pending`, `succeeded`, and `failed`, carries an operation identity, disables only conflicting intent while pending, and ends in visible confirmation or failure. Durable writes and destructive actions keep failures visible until retry or dismissal. Combat failures remain inline and non-modal. Automatic retries log once per operation rather than producing repeated notices.

Optimistic UI is permitted only when the old value is retained, the operation can roll back, and failure appears beside the control. Otherwise authoritative UI changes only after confirmation.

Every repeatable request uses a latest-operation identity. A late completion may be logged, but cannot replace newer data, clear a newer pending indicator, or report success for superseded intent. Fire-and-forget is reserved for explicitly documented telemetry-like work; native calls initiated by a player are awaited.

Feedback belongs to the surface that owns the operation: toolbar status for toolbar actions, row feedback for row actions, panel state for resources, and durable global feedback for persistence or safety failures. Logs use the same operation identity when diagnostic correlation is needed.
