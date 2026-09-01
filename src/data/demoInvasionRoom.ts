import type { RoomText } from '../lib/roomText'

/**
 * A deliberately busy, real Crossing interior used by the development bridge.
 *
 * The copy is the room lore already curated in
 * data/art/room-prompts-priority.json (entry `1::Guildleader's Office`). It is
 * kept as a tiny runtime fixture too because the complete room-text library is
 * generated and downloaded rather than committed. That lets a fresh clone
 * exercise a long description and the correct interior scene before the
 * optional room-text payload has been fetched.
 */
export const DEMO_INVASION_ROOM = 308

export const DEMO_INVASION_ROOM_TEXT: RoomText = {
  title: "Empaths' Guild, Guildleader's Office",
  text:
    'Paneled in dark mahogany, this richly appointed office is redolent with the scent of amber and leather. A massive mahogany desk dominates the space, its glossy lacquered surface scattered with papers and writing implements. Behind the desk is an enormous tufted leather wing chair, its rich brown leather complementing the lustrous mahogany. A decanter of ruby port sits atop a mahogany liquor cabinet, numerous bottles of various colors and sizes visible behind the closed glass doors. The open-skied courtyard garden of the guild proper is visible to the southwest, through a short stone-lined antechamber.',
}
