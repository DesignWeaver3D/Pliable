/** Which kind of computer the app runs on, for the few places where the keyboards differ. */

/** Whether a platform name (navigator.platform, or userAgentData.platform) is an Apple one. */
export function isApple(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } });

/** True on a Mac: its laptops have no Delete key (the key in that place reports Backspace). */
export const IS_MAC = isApple(nav?.userAgentData?.platform || nav?.platform || "");

/** A text that names keys, with the names this computer's keyboard prints: on a Mac, Ctrl reads Cmd and Alt reads Option.
 *  Only for text the user reads; chords are stored and compared with the Ctrl and Alt names everywhere. */
export function keyNames(text: string, mac = IS_MAC): string {
  return mac ? text.replace(/\bCtrl\b/g, "Cmd").replace(/\bAlt\b/g, "Option") : text;
}
