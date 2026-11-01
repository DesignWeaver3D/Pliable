/** Angle ranges used by the sketch tools, one named helper per range so every tool picks the range it means on purpose.
 *  They differ at 0 and at half a turn: a turn of 0 is nothing in `turnCounterclockwise` but a full circle in `sweepCounterclockwise`,
 *  and a half turn is -pi in `turnShortWay`. */
export const TWO_PI = 2 * Math.PI;

/** An angle turned into [0, 2 pi): the counterclockwise turn it stands for (0 stays 0). */
export const turnCounterclockwise = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** The counterclockwise sweep from angle `from` to angle `to`, in (0, 2 pi]: the same angle is a full turn. */
export function sweepCounterclockwise(from: number, to: number): number {
  return turnCounterclockwise(to - from) || TWO_PI;
}

/** A signed turn (such as the difference of two atan2 angles, within one turn either way) made counterclockwise by adding a turn unless it is positive: (0, 2 pi]. */
export const positiveSweep = (sweep: number) => (sweep <= 0 ? sweep + TWO_PI : sweep);

/** An angle turned into [-pi, pi): the short way round, with exactly half a turn (either way) counted as -pi. */
export function turnShortWay(turn: number): number {
  return turn - TWO_PI * Math.round(turn / TWO_PI);
}
