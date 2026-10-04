// Tiny YAML emitter + Talos-style strategic merge, just enough for the demos.

export type Y = string | number | boolean | null | Y[] | { [k: string]: Y };
export type Line = { id: string; text: string; comment?: string };

const isObj = (v: Y): v is { [k: string]: Y } => typeof v === "object" && v !== null && !Array.isArray(v);

function scalar(v: Y): string {
  if (typeof v === "string") {
    if (v === "" || /^[\s]|[\s]$|^[@&*!|>%`'"{[\]#,]|: | #|^(true|false|null|yes|no|on|off|~)$|^\d+(\.\d+)?$/i.test(v)) return JSON.stringify(v);
    return v;
  }
  return String(v);
}

/** Emit YAML lines; each line carries a stable identity (path + text) used to diff. */
export function emit(v: Y, indent = 0, path = ""): Line[] {
  const pad = " ".repeat(indent);
  const out: Line[] = [];
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      const p = `${path}.${k}`;
      if (isObj(val) && Object.keys(val).length) {
        out.push({ id: p, text: `${pad}${k}:` });
        out.push(...emit(val, indent + 2, p));
      } else if (Array.isArray(val) && val.length) {
        out.push({ id: p, text: `${pad}${k}:` });
        out.push(...emit(val, indent + 2, p));
      } else {
        const s = isObj(val) ? "{}" : Array.isArray(val) ? "[]" : scalar(val);
        out.push({ id: `${p}=${s}`, text: `${pad}${k}: ${s}` });
      }
    }
  } else if (Array.isArray(v)) {
    v.forEach((item, i) => {
      const p = `${path}[${itemKey(item, i)}]`;
      if (isObj(item)) {
        const inner = emit(item, indent + 2, p);
        if (inner.length) inner[0] = { ...inner[0], text: `${pad}- ${inner[0].text.trimStart()}` };
        out.push(...inner);
      } else {
        out.push({ id: `${p}=${scalar(item)}`, text: `${pad}- ${scalar(item)}` });
      }
    });
  }
  return out;
}

function itemKey(item: Y, i: number): string {
  if (isObj(item)) {
    if (typeof item.interface === "string") return `if=${item.interface}`;
    if (item.deviceSelector) return `sel=${JSON.stringify(item.deviceSelector)}`;
    if (typeof item.name === "string") return `name=${item.name}`;
  }
  if (typeof item === "string") return item;
  return String(i);
}

function sameListItem(a: Y, b: Y): boolean {
  if (!isObj(a) || !isObj(b)) return false;
  if (a.interface !== undefined && a.interface === b.interface) return true;
  if (a.deviceSelector && b.deviceSelector) return JSON.stringify(a.deviceSelector) === JSON.stringify(b.deviceSelector);
  return false;
}

/**
 * Strategic merge as Talos does it (simplified): maps merge recursively, scalars are replaced,
 * lists are appended, except network interfaces which merge by `interface` / `deviceSelector`.
 */
export function merge(base: Y, patch: Y): Y {
  if (isObj(base) && isObj(patch)) {
    const out: { [k: string]: Y } = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = k in base ? merge(base[k], v) : v;
    return out;
  }
  if (Array.isArray(base) && Array.isArray(patch)) {
    const out = [...base];
    for (const item of patch) {
      const idx = out.findIndex((x) => sameListItem(x, item));
      if (idx >= 0) out[idx] = merge(out[idx], item);
      else if (!out.some((x) => JSON.stringify(x) === JSON.stringify(item))) out.push(item);
    }
    return out;
  }
  return patch;
}
