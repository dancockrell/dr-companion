/**
 * The body: sixteen parts, each with a wound and a scar, 0-3.
 *
 * Lives here rather than in the paperdoll component because the character type
 * needs it too, and a types file that imports a React component to name a
 * field has its dependencies backwards.
 *
 * Severity labels are ours. Lich packs severity two bits per part into
 * wound_gsl and carries no names for the levels. See DESIGN.md S2.
 */
export type Severity = 0 | 1 | 2 | 3

export interface Injury {
  wound: Severity
  scar: Severity
}

export const BODY_PARTS = [
  'head', 'neck', 'chest', 'abdomen', 'back',
  'leftArm', 'rightArm', 'leftHand', 'rightHand',
  'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot',
  'leftEye', 'rightEye', 'nsys',
] as const

export type BodyPart = (typeof BODY_PARTS)[number]

export const SEVERITY_LABEL: Record<Severity, string> = {
  0: 'unhurt',
  1: 'minor',
  2: 'serious',
  3: 'severe',
}

/** Display names for the parts whose keys are camelCase. */
export const PRETTY: Partial<Record<BodyPart, string>> = {
  leftArm: 'left arm', rightArm: 'right arm',
  leftHand: 'left hand', rightHand: 'right hand',
  leftLeg: 'left leg', rightLeg: 'right leg',
  leftFoot: 'left foot', rightFoot: 'right foot',
  leftEye: 'left eye', rightEye: 'right eye',
  nsys: 'nervous system',
}

