/**
 * The cartographers' colours, translated into ink.
 *
 * The map data carries sixteen colours and most are fully saturated RGB
 * primaries: pure cyan on 960 rooms, pure red on 824, pure blue on 783. On
 * Genie's cream ground those read as pen highlights. Dropped onto a dark
 * window they read as a subway map, and the whole chart turns into a network
 * diagram lit from behind.
 *
 * What this map should feel like is what it actually is: a survey chart that
 * players have been drawing by hand for twenty years. Ink on dark vellum.
 * Warm, quiet ground; rooms as inked boxes; streets as fine pen lines; and the
 * categories the cartographers chose still present but muted into the page
 * rather than shouting over it.
 *
 * Exactly one thing on the chart is bright, and it is where you are standing.
 *
 * Hue is preserved throughout — a room the cartographers made red is still
 * red — because the distinction is theirs and this only changes its volume.
 */
export const INK: Record<string, string> = {
  '#00FFFF': '#4f8f8a', // dusty teal
  '#FF0000': '#a34a42', // oxblood
  '#0000FF': '#5566a8', // indigo
  '#00FF00': '#5f9459', // verdigris
  '#008000': '#4a7346', // moss
  '#993300': '#8a5a3c', // sepia
  '#C2B280': '#b0a276', // sand, already of the page
  '#FFBF00': '#c39a4a', // ochre
  '#FF8000': '#b87741', // burnt orange
  '#FF00FF': '#96588c', // murex
  '#FFFF00': '#bfae57', // old gold
  '#A6A3D9': '#8d8ab4', // dusty violet
  '#000080': '#5a68a0', // deep indigo
  '#00BF80': '#4f8f74', // sea green
  '#400040': '#7d5a7d', // aubergine
  '#800080': '#9a679a', // plum
}

/**
 * The ink for a cartographer's colour.
 *
 * Unknown values fall back to the plain room fill rather than being drawn
 * raw: a colour nobody translated is more likely a mistake in the data than a
 * category worth shouting, and one neon square on a muted chart is exactly the
 * thing this file exists to prevent.
 */
export function inkFor(colour: string | undefined, fallback: string): string {
  if (!colour) return fallback
  return INK[colour.toUpperCase()] ?? fallback
}
