// Pure logic of the command search: scope prefixes, keyword matching, ranking and the recently used list.

export type Scope = "tool" | "setting" | "body" | "view" | "file";

/** What each prefix typed before a colon selects. */
export const SCOPES: { prefix: string; scope: Scope; name: string }[] = [
  { prefix: "t", scope: "tool", name: "tools" },
  { prefix: "s", scope: "setting", name: "settings" },
  { prefix: "b", scope: "body", name: "bodies" },
  { prefix: "v", scope: "view", name: "view commands" },
  { prefix: "f", scope: "file", name: "files and demos" },
];

export interface Searchable {
  label: string;
  scope?: Scope;
  keywords?: string[];
}

/** Split "t:fil" into its scope and the text after the colon. An unknown prefix is left as plain text. */
export function parseQuery(raw: string): { scope: Scope | null; text: string } {
  const m = /^\s*([a-z]):\s*(.*)$/i.exec(raw);
  const found = m && SCOPES.find((s) => s.prefix === m[1].toLowerCase());
  return found ? { scope: found.scope, text: m![2].trim() } : { scope: null, text: raw.trim() };
}

/** Subsequence match, so "fc" finds "Fillet/Chamfer". */
export function subsequence(text: string, query: string): boolean {
  const t = text.toLowerCase();
  let at = 0;
  for (const ch of query.toLowerCase()) {
    at = t.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

/** Lower is better; null means no match. Word starts in the label beat loose letters; keywords match whole words by prefix. */
export function matchRank(item: Searchable, text: string): number | null {
  if (!text) return 0;
  const q = text.toLowerCase().replace(/_/g, " "); // tool ids such as patch_fill find "Patch fill"
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if ((item.keywords ?? []).some((k) => k.toLowerCase().startsWith(q) || k.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q)))) return 3;
  // Loose letters only for short abbreviations like "fc"; longer words must really appear.
  return q.length <= 3 && subsequence(item.label, q) ? 4 : null;
}

/** Items matching the query in the order to show them. With an empty text the recently used come first (newest first). */
export function searchItems<T extends Searchable>(items: T[], raw: string, recents: string[] = []): T[] {
  const { scope, text } = parseQuery(raw);
  const pool = scope ? items.filter((i) => i.scope === scope) : items;
  if (!text) {
    if (scope) return pool;
    const order = (i: T) => {
      const at = recents.indexOf(i.label);
      return at < 0 ? recents.length : at;
    };
    return pool.map((item, n) => ({ item, n })).sort((a, b) => order(a.item) - order(b.item) || a.n - b.n).map((x) => x.item);
  }
  return pool
    .map((item, n) => ({ item, n, rank: matchRank(item, text) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || a.n - b.n)
    .map((x) => x.item);
}

export const MAX_RECENTS = 6;

export function pushRecent(recents: string[], label: string, max = MAX_RECENTS): string[] {
  return [label, ...recents.filter((l) => l !== label)].slice(0, max);
}

const RECENT_KEY = "pliable.recentCommands";

export function loadRecents(storage: Pick<Storage, "getItem"> | null = safeStorage()): string[] {
  try {
    const raw = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x: unknown): x is string => typeof x === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function saveRecents(recents: string[], storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(recents));
  } catch {
    /* storage can be blocked */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Search words for tools by id, so the names other programs use find the matching tool. */
const TOOL_WORDS: [RegExp, string[]][] = [
  [/fillet|round/, ["fillet", "round", "blend", "radius", "smooth edge"]],
  [/chamfer/, ["chamfer", "bevel", "break edge"]],
  [/convert_to_countersink|convert_to_counterbore/, ["convert", "existing", "change", "both ends", "far end"]],
  [/hole|boss|counter|countersink|slot/, ["hole", "drill", "bore", "boss", "pin", "peg"]],
  [/^move_|move_body|move_hole/, ["move", "translate", "shift", "position"]],
  [/move_body/, ["rotate", "turn", "spin", "orient", "angle"]],
  [/rotate/, ["rotate", "turn", "spin", "angle"]],
  [/scale/, ["scale", "resize", "size", "grow", "shrink"]],
  [/push_pull|offset|stretch/, ["extrude", "push", "pull", "offset", "thicken"]],
  [/shell/, ["shell", "hollow", "thin wall"]],
  [/array|pattern/, ["array", "pattern", "copy", "repeat", "duplicate"]],
  [/mirror/, ["mirror", "symmetry", "flip"]],
  [/boolean/, ["union", "subtract", "cut", "intersect", "join", "merge"]],
  [/cut_plane|split/, ["cut", "split", "slice", "section"]],
  [/draft/, ["draft", "taper", "angle", "mold"]],
  [/revolve|sweep|loft/, ["revolve", "sweep", "loft", "lathe", "spin"]],
  [/add_prism/, ["prism", "hexagon", "polygon", "hex", "pentagon", "octagon", "extruded polygon"]],
  [/add_/, ["add", "create", "new", "primitive", "make"]],
  [/delete_face|unify|fill_hole|patch/, ["delete", "remove", "defeature", "heal", "repair"]],
  [/^unify$/, ["unify", "refine", "merge faces", "coplanar", "simplify"]],
  [/^patch_fill$/, ["patch fill", "patch_fill", "fill gap", "cap", "close gap", "surface"]],
  [/^bridge$/, ["bridge", "bridge edges", "join edges", "ruled surface"]],
  [/^concentric_array$/, ["concentric array", "concentric circles", "rings", "radial pattern", "polar", "circular pattern"]],
  [/^path_array$/, ["path array", "array along path", "along edge", "along curve", "path"]],
];

export function toolKeywords(id: string): string[] {
  return [...new Set(TOOL_WORDS.filter(([re]) => re.test(id)).flatMap(([, w]) => w))];
}
