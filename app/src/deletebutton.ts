/** The one delete button every list row uses (sketch list, datum plane list, constraint list): a trash can icon. */
import { uiIcon } from "./icons";

export function deleteButton(title: string, onClick: () => void, className = "rowbtn", size = 14): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = className;
  b.title = title;
  b.append(uiIcon("trash", size));
  b.addEventListener("click", onClick);
  return b;
}
