import type { Transition } from 'motion/react'

/**
 * Spring house-style (apple-design §4). Apple designs motion with two
 * parameters — damping ratio (overshoot) and response (how fast it reaches the
 * target) — and Motion's `bounce` + `duration` map onto them closely.
 *
 * The default is critically damped: no overshoot. Bounce is reserved for
 * motion that carries real momentum (a flick, a drag release) — never for
 * something that merely faded or appeared, where overshoot reads as wrong.
 */

/** Default UI spring — critically damped, no overshoot (≈ damping 1.0 / response 0.4). */
export const springDefault: Transition = { type: 'spring', bounce: 0, duration: 0.4 }

/** Snappier chrome (tabs, banners) — critically damped (≈ damping 1.0 / response 0.3). */
export const springSnappy: Transition = { type: 'spring', bounce: 0, duration: 0.3 }

/** Sheet / drawer (≈ damping 0.8 / response 0.3). */
export const springSheet: Transition = { type: 'spring', bounce: 0.1, duration: 0.3 }

/** Momentum interaction — slight overshoot, only after a flick/drag (≈ damping 0.8). */
export const springMomentum: Transition = { type: 'spring', bounce: 0.2, duration: 0.4 }

/** Short opacity cross-fade for content swaps — no motion, so no added latency. */
export const fadeQuick: Transition = { duration: 0.15, ease: 'easeOut' }
