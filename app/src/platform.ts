/** Which kind of computer the app runs on, for the few places where the keyboards differ. */

/** Whether a platform name (navigator.platform, or userAgentData.platform) is an Apple one. */
export function isApple(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } });

/** True on a Mac: its laptops have no Delete key (the key in that place reports Backspace). */
export const IS_MAC = isApple(nav?.userAgentData?.platform || nav?.platform || "");
