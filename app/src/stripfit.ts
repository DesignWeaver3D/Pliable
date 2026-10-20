/** The room for the strip: the window width less what the left side (body list, open drawer) and the right side (nav cube,
 *  view controls) keep. The strip is centred in the room that is left, so `centre` is its middle in window pixels. */
export function stripRoom(viewWidth: number, leftReserve: number, rightReserve: number): { width: number; centre: number } {
  const width = Math.max(120, viewWidth - leftReserve - rightReserve);
  return { width, centre: leftReserve + width / 2 };
}
