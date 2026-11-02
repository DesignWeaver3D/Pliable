/** The shared number entry field: a text box that takes only the characters a number can have in the user's decimal style
 *  (see numberformat.ts), in place of the browser's own number input, which follows the browser's language and not the
 *  setting. Read it with `fieldNumber`; fill it with `fieldText`. A field holding something that is not a number gets a red border. */
import { allowedChars, entryText, parseNumber } from "./numberformat.ts";

/** Make an input a number entry (it keeps its value, title and listeners). */
export function numericField(input: HTMLInputElement): HTMLInputElement {
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("beforeinput", (e) => {
    if (e.data && ![...e.data].every(allowedChars)) e.preventDefault();
  });
  return input;
}

/** The number in a field, or null when it is blank or not a number (the field turns red when it holds something that is not). */
export function fieldNumber(input: HTMLInputElement | HTMLSelectElement): number | null {
  const n = parseNumber(input.value);
  input.style.borderColor = n === null && input.value.trim() !== "" ? "#ff4d4d" : "";
  return n;
}

/** A number as field text, in the user's decimal style. */
export function fieldText(n: number | string): string {
  return entryText(String(n));
}
