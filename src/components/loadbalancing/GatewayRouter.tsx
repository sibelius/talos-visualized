"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button, Pill, Segmented, Slider, Toggle } from "../ui";

type Scheme = "http" | "https";
type PathMatch = { type: "Exact" | "PathPrefix"; value: string };
type Rule = { id: string; path: PathMatch; headers?: Record<string, string>; backends?: { name: string; weight: number }[]; redirect?: string };
type Route = { name: string; section: "http" | "https"; hostnames: string[]; rules: Rule[] };

const LISTENERS = [
  { name: "http", port: 80, protocol: "HTTP", hostname: "*.example.com" },
  { name: "https", port: 443, protocol: "HTTPS", hostname: "*.example.com", tls: "Terminate · wildcard-cert" },
];

function routes(canary: number): Route[] {
  return [
    { name: "http-redirect", section: "http", hostnames: [], rules: [{ id: "redirect", path: { type: "PathPrefix", value: "/" }, redirect: "301 → https" }] },
    {
      name: "shop",
      section: "https",
      hostnames: ["shop.example.com"],
      rules: [
        { id: "api-canary-header", path: { type: "PathPrefix", value: "/api" }, headers: { "x-canary": "always" }, backends: [{ name: "api-v2", weight: 1 }] },
        { id: "api", path: { type: "PathPrefix", value: "/api" }, backends: [{ name: "api-v1", weight: 100 - canary }, { name: "api-v2", weight: canary }] },
        { id: "web", path: { type: "PathPrefix", value: "/" }, backends: [{ name: "shop-web", weight: 1 }] },
      ],
    },
    {
      name: "docs",
      section: "https",
      hostnames: ["docs.example.com"],
      rules: [{ id: "docs", path: { type: "PathPrefix", value: "/" }, backends: [{ name: "docs-web", weight: 1 }] }],
    },
  ];
}

const BACKENDS = ["api-v1", "api-v2", "shop-web", "docs-web"];
const BACKEND_COLOR: Record<string, string> = {
  "api-v1": "var(--color-f1)",
  "api-v2": "var(--color-f3)",
  "shop-web": "var(--color-f2)",
  "docs-web": "var(--color-f4)",
};

const PRESETS: { label: string; scheme: Scheme; host: string; path: string; canary: boolean }[] = [
  { label: "shop API", scheme: "https", host: "shop.example.com", path: "/api/cart", canary: false },
  { label: "API + canary header", scheme: "https", host: "shop.example.com", path: "/api/cart", canary: true },
  { label: "shop homepage", scheme: "https", host: "shop.example.com", path: "/products/42", canary: false },
  { label: "docs", scheme: "https", host: "docs.example.com", path: "/install", canary: false },
  { label: "plain http", scheme: "http", host: "shop.example.com", path: "/api/cart", canary: false },
  { label: "/apiary (prefix trap)", scheme: "https", host: "shop.example.com", path: "/apiary", canary: false },
  { label: "unknown host", scheme: "https", host: "evil.test", path: "/", canary: false },
];

function hostMatches(pattern: string, host: string) {
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return pattern === host;
}

/** Gateway API PathPrefix matches whole path segments: /api matches /api and /api/x, not /apiary. */
function pathMatches(m: PathMatch, path: string) {
  if (m.type === "Exact") return path === m.value;
  if (m.value === "/") return true;
  return path === m.value || path.startsWith(m.value.replace(/\/$/, "") + "/");
}

type Trace = {
  listener: (typeof LISTENERS)[number] | null;
  route: Route | null;
  rule: Rule | null;
  candidates: { route: Route; rule: Rule; ok: boolean; why: string }[];
  outcome: string;
};

function resolve(scheme: Scheme, host: string, path: string, canary: boolean, canaryPct: number): Trace {
  const port = scheme === "https" ? 443 : 80;
  const listener = LISTENERS.find((l) => l.port === port && hostMatches(l.hostname, host)) ?? null;
  if (!listener) return { listener, route: null, rule: null, candidates: [], outcome: "No listener matches this hostname → connection rejected / 404 at the Gateway." };
  const headers: Record<string, string> = canary ? { "x-canary": "always" } : {};
  const cands: Trace["candidates"] = [];
  for (const r of routes(canaryPct)) {
    if (r.section !== listener.name) continue;
    if (r.hostnames.length && !r.hostnames.includes(host)) {
      r.rules.forEach((rule) => cands.push({ route: r, rule, ok: false, why: "hostname" }));
      continue;
    }
    for (const rule of r.rules) {
      if (!pathMatches(rule.path, path)) cands.push({ route: r, rule, ok: false, why: "path" });
      else if (rule.headers && Object.entries(rule.headers).some(([k, v]) => headers[k] !== v)) cands.push({ route: r, rule, ok: false, why: "header" });
      else cands.push({ route: r, rule, ok: true, why: "" });
    }
  }
  // precedence: Exact > longest prefix > more header matches
  const ok = cands
    .filter((c) => c.ok)
    .sort(
      (a, b) =>
        Number(b.rule.path.type === "Exact") - Number(a.rule.path.type === "Exact") ||
        b.rule.path.value.length - a.rule.path.value.length ||
        Object.keys(b.rule.headers ?? {}).length - Object.keys(a.rule.headers ?? {}).length,
    );
  const win = ok[0];
  if (!win) return { listener, route: null, rule: null, candidates: cands, outcome: "Listener accepted it, but no HTTPRoute rule matches → 404." };
  return {
    listener,
    route: win.route,
    rule: win.rule,
    candidates: cands,
    outcome: win.rule.redirect ? "RequestRedirect filter: 301 to https://" + host + path : "Forwarded to a backend chosen by weight.",
  };
}

function weightedPick(bs: { name: string; weight: number }[]) {
  const total = bs.reduce((a, b) => a + b.weight, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const b of bs) {
    if ((r -= b.weight) < 0) return b.name;
  }
  return bs[bs.length - 1].name;
}

export function GatewayRouter() {
  const [scheme, setScheme] = useState<Scheme>("https");
  const [host, setHost] = useState("shop.example.com");
  const [path, setPath] = useState("/api/cart");
  const [canary, setCanary] = useState(false);
  const [pct, setPct] = useState(10);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [last, setLast] = useState<string | null>(null);

  const trace = useMemo(() => resolve(scheme, host.trim().toLowerCase(), path || "/", canary, pct), [scheme, host, path, canary, pct]);
  const totalSent = Object.values(counts).reduce((a, b) => a + b, 0);

  function send(n: number) {
    const bs = trace.rule?.backends;
    if (!bs) {
      setCounts((c) => ({ ...c, [trace.rule?.redirect ? "301 redirect" : "404"]: (c[trace.rule?.redirect ? "301 redirect" : "404"] ?? 0) + n }));
      setLast(trace.rule?.redirect ? "301 redirect" : "404");
      return;
    }
    const next: Record<string, number> = {};
    let l: string | null = null;
    for (let i = 0; i < n; i++) {
      const b = weightedPick(bs);
      if (b) next[b] = (next[b] ?? 0) + 1;
      l = b;
    }
    setCounts((c) => {
      const out = { ...c };
      for (const [k, v] of Object.entries(next)) out[k] = (out[k] ?? 0) + v;
      return out;
    });
    setLast(l);
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setScheme(p.scheme);
    setHost(p.host);
    setPath(p.path);
    setCanary(p.canary);
  }

  const stage = (on: boolean, bad = false) =>
    clsx("rounded-xl border p-3 transition-all", on ? (bad ? "border-bad/60 bg-bad/5" : "border-accent/60 bg-accent/5") : "border-line bg-panel-2/40 opacity-60");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs text-muted transition hover:border-faint hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-bg p-3 font-mono text-[12.5px] sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
        <Segmented value={scheme} onChange={setScheme} options={["http", "https"] as const} />
        <label className="flex items-center gap-2">
          <span className="text-faint">Host:</span>
          <input aria-label="Host header" value={host} onChange={(e) => setHost(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-ink outline-none focus:border-accent" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-faint">GET</span>
          <input aria-label="Request path" value={path} onChange={(e) => setPath(e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-ink outline-none focus:border-accent" />
        </label>
        <Toggle checked={canary} onChange={setCanary} label={<span className="font-mono text-xs">x-canary: always</span>} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr_1fr]">
        {/* listener */}
        <div className={stage(!!trace.listener, !trace.listener)}>
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">1 · Gateway listener</div>
          <div className="space-y-1.5">
            {LISTENERS.map((l) => (
              <div key={l.name} className={clsx("rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px]", trace.listener?.name === l.name ? "border-accent text-ink" : "border-line text-faint")}>
                {l.name} · {l.protocol}:{l.port} · {l.hostname}
                {l.tls && <div className="text-[10.5px] text-faint">tls: {l.tls}</div>}
              </div>
            ))}
          </div>
          {!trace.listener && <p className="mt-2 text-xs text-bad">No listener for {scheme}:{host}</p>}
        </div>

        {/* routes */}
        <div className={stage(!!trace.rule, !!trace.listener && !trace.rule)}>
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">2 · HTTPRoute rules (most specific wins)</div>
          <div className="space-y-1.5">
            {routes(pct).map((r) => (
              <div key={r.name} className="rounded-lg border border-line p-2">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="text-ink">HTTPRoute/{r.name}</span>
                  <Pill>sectionName: {r.section}</Pill>
                  {r.hostnames.map((h) => (
                    <Pill key={h}>{h}</Pill>
                  ))}
                </div>
                {r.rules.map((rule) => {
                  const c = trace.candidates.find((x) => x.rule.id === rule.id && x.route.name === r.name);
                  const winner = trace.rule?.id === rule.id && trace.route?.name === r.name;
                  return (
                    <div
                      key={rule.id}
                      className={clsx(
                        "flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 font-mono text-[11px] transition",
                        winner ? "bg-accent/15 text-ink" : c?.ok ? "text-muted" : "text-faint",
                      )}
                    >
                      <span>
                        {rule.path.type} {rule.path.value}
                        {rule.headers && Object.entries(rule.headers).map(([k, v]) => ` + ${k}=${v}`)}
                      </span>
                      <span className="text-[10.5px]">
                        {winner ? "✓ selected" : c ? (c.ok ? "matches, less specific" : `✕ ${c.why}`) : "not attached to this listener"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* backends */}
        <div className={stage(!!trace.rule?.backends)}>
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">3 · backendRefs</div>
          {trace.rule?.backends ? (
            <div className="space-y-1.5">
              {trace.rule.backends.map((b) => {
                const total = trace.rule!.backends!.reduce((a, x) => a + x.weight, 0);
                return (
                  <div key={b.name} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 font-mono text-[11.5px]" style={{ color: BACKEND_COLOR[b.name] }}>
                    <span>Service/{b.name}</span>
                    <span>{total ? Math.round((100 * b.weight) / total) : 0}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-faint">{trace.rule?.redirect ? "No backend — a RequestRedirect filter answers directly." : "—"}</p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">{trace.outcome}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => send(1)}>Send 1</Button>
        <Button onClick={() => send(100)}>Send 100</Button>
        <Button variant="ghost" onClick={() => { setCounts({}); setLast(null); }}>Clear</Button>
        <Slider label="api-v2 canary weight" value={pct} min={0} max={100} onChange={setPct} format={(v) => `${100 - v}/${v}`} />
      </div>

      <div className="rounded-xl border border-line bg-panel-2/40 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] tracking-wide text-faint uppercase">
          <span>responses by backend</span>
          <span className="font-mono normal-case">{totalSent} sent{last ? ` · last → ${last}` : ""}</span>
        </div>
        <div className="space-y-1.5">
          {[...BACKENDS, "301 redirect", "404"].map((b) => {
            const v = counts[b] ?? 0;
            const color = BACKEND_COLOR[b] ?? (b === "404" ? "var(--color-bad)" : "var(--color-info)");
            return (
              <div key={b} className="grid grid-cols-[96px_1fr_64px] items-center gap-2 font-mono text-[11.5px]">
                <span style={{ color }}>{b}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${totalSent ? (100 * v) / totalSent : 0}%`, background: color }} />
                </div>
                <span className="text-right text-muted tabular-nums">
                  {v} {totalSent ? `(${Math.round((100 * v) / totalSent)}%)` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
