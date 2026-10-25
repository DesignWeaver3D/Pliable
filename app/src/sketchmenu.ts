/** A small menu next to the cursor for choosing among several fits (the smart dimension). Closes on a choice, Escape or a click elsewhere. */
export function chooseAtCursor<T extends { label: string }>(at: { x: number; y: number }, items: T[]): Promise<T | null> {
  return new Promise((resolve) => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.style.cssText = `position:fixed;left:${Math.round(at.x + 8)}px;top:${Math.round(at.y + 8)}px;z-index:30;display:flex;flex-direction:column;gap:2px;padding:4px;background:#2a2d34;border:1px solid #555;border-radius:6px;font:13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.5)`;
    const done = (choice: T | null) => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      menu.remove();
      resolve(choice);
    };
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) done(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done(null);
    };
    for (const item of items) {
      const b = document.createElement("button");
      b.textContent = item.label;
      b.setAttribute("role", "menuitem");
      b.style.cssText = "text-align:left;padding:4px 10px;background:#2a2d34;color:var(--ui-offwhite,#ddd);border:1px solid transparent;border-radius:4px;cursor:pointer";
      b.addEventListener("pointerenter", () => (b.style.borderColor = "#ff8a1f"));
      b.addEventListener("pointerleave", () => (b.style.borderColor = "transparent"));
      b.addEventListener("click", () => done(item));
      menu.append(b);
    }
    document.body.append(menu);
    const r = menu.getBoundingClientRect(); // keep it on screen
    if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    (menu.firstElementChild as HTMLElement | null)?.focus();
  });
}
