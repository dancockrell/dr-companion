/**
 * What never appears in generated art, and what always does.
 *
 * The art pack ships with the app. Every render here is a default that a
 * player meets before they have chosen anything, which makes this a shipping
 * standard rather than a preference: portraits, creatures and rooms are all
 * held to it.
 *
 * The reason this file exists rather than a line in each generator is that the
 * first version had the same negative prompt copied into three files, none of
 * which mentioned nudity, and the female portraits came back topless. Three
 * copies means three places to forget.
 */

/**
 * The negative clause.
 *
 * At cfg 1.0 this has a real but weak effect — rendering with and against it
 * gives different images, which was checked rather than assumed — so it is the
 * backstop, never the whole guard. Anything that must not appear also needs
 * stating positively in the prompt.
 */
export const NEGATIVE =
  'nude, nudity, naked, topless, bare chest, bare breasts, exposed skin, ' +
  'cleavage, lingerie, underwear, suggestive, sexualised, ' +
  'text, watermark, signature, logo, frame, border, multiple views, ' +
  'photorealistic, cartoon, anime, cute, chibi'

/**
 * Clothing, stated positively, for anything with a humanoid figure.
 *
 * This is the half that actually works. "Head and shoulders portrait"
 * describes the crop and not the subject, and the model will happily fill an
 * unclothed torso into it. Saying what the figure is wearing removes the
 * question instead of cropping around it.
 */
export const CLOTHED =
  'fully clothed in layered travelling garb, high collar, tunic and cloak ' +
  'covering the chest and shoulders'
