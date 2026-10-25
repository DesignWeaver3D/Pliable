/** A small right-click menu for a row of a project list (sketches, datum planes): one Delete entry, styled like the bodies list menu. */
let open: HTMLElement | null = null;

export function closeRowMenu() {
  open?.remove();
  open = null;
}

export function openRowMenu(x: number, y: number, label: string, remove: () => void, title: string) {
  openRowMenuItems(x, y, [{ label, run: remove, title }]);
}

/** The same menu with several entries (Rename and Delete for the sketches list). */
export function openRowMenuItems(x: number, y: number, items: { label: string; run: () => void; title: string }[]) {
  closeRowMenu();
  const menu = document.createElement("div");
  menu.className = "bodymenu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.title = item.title;
    button.addEventListener("click", () => {
      closeRowMenu();
      item.run();
    });
    menu.append(button);
  }
  menu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 30 * items.length - 30)}px`;
  document.body.append(menu);
  open = menu;
  const away = (e: Event) => {
    if (e instanceof KeyboardEvent ? e.key !== "Escape" : menu.contains(e.target as Node)) return;
    closeRowMenu();
    document.removeEventListener("pointerdown", away, true);
    window.removeEventListener("keydown", away);
  };
  document.addEventListener("pointerdown", away, true);
  window.addEventListener("keydown", away);
}
