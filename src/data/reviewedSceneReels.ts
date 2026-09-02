import sceneReels from '../../data/art/scene-reels.json' with { type: 'json' }

export interface ReviewedSceneReelSelection {
  url: string
  reelId: string
  frameIndex: number
  timestampSeconds: number
  semanticTags: readonly string[]
}

/**
 * Resolve an explicitly audited route reel before broader place/text art.
 * The source registry is shared with production metadata tooling, so runtime
 * selection cannot silently drift away from the reviewed frame order.
 */
export function reviewedSceneReel(zone: string, room: number): ReviewedSceneReelSelection | null {
  for (const reel of sceneReels.reels) {
    if (reel.audit.verdict !== 'approved' || reel.runtimeSelection.zone !== zone) continue
    const range = reel.runtimeSelection.roomRanges.find(([first, last]) => room >= first && room <= last)
    if (!range) continue
    const frameIndex = Math.floor((room - range[0]) / reel.runtimeSelection.roomsPerFrame) % reel.frames.length
    const frame = reel.frames[frameIndex]
    return {
      url: frame.path,
      reelId: reel.id,
      frameIndex,
      timestampSeconds: frame.timestampSeconds,
      semanticTags: reel.semanticTags,
    }
  }
  return null
}
