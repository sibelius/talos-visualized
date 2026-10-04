"use client";

import { useState } from "react";
import clsx from "clsx";
import { Mono, Panel, Segmented } from "../ui";

type Mode = "and" | "or" | "any-ns";

const PODS = [
  { ns: "monitoring", name: "prometheus", app: "prometheus" },
  { ns: "monitoring", name: "grafana", app: "grafana" },
  { ns: "monitoring", name: "toolbox", app: "toolbox" },
  { ns: "shop", name: "frontend", app: "frontend" },
  { ns: "shop", name: "metrics-agent", app: "prometheus" },
  { ns: "staging", name: "prometheus", app: "prometheus" },
  { ns: "staging", name: "debug", app: "debug" },
];

const YAML: Record<Mode, string> = {
  and: `# policy lives in namespace "shop"
ingress:
- from:
  - namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: monitoring
    podSelector:            # same list item (no dash)
      matchLabels:
        app: prometheus`,
  or: `# policy lives in namespace "shop"
ingress:
- from:
  - namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: monitoring
  - podSelector:            # <- one extra "-" : new item
      matchLabels:
        app: prometheus`,
  "any-ns": `# policy lives in namespace "shop"
ingress:
- from:
  - namespaceSelector: {}   # every namespace
    podSelector:
      matchLabels:
        app: prometheus`,
};

const EXPLAIN: Record<Mode, string> = {
  and: "One peer with both selectors: the pod must be in a namespace labelled monitoring AND carry app=prometheus. Exactly one pod matches.",
  or: "Two peers: (any pod in monitoring) OR (app=prometheus in the policy's own namespace). A single dash just opened the API to grafana, toolbox and anything else that lands in monitoring.",
  "any-ns": "An empty namespaceSelector means all namespaces, so app=prometheus anywhere matches — including staging. Labels are self-asserted by whoever can create pods there.",
};

function matches(mode: Mode, p: (typeof PODS)[number]) {
  if (mode === "and") return p.ns === "monitoring" && p.app === "prometheus";
  if (mode === "or") return p.ns === "monitoring" || (p.ns === "shop" && p.app === "prometheus");
  return p.app === "prometheus";
}

export function SelectorGotcha() {
  const [mode, setMode] = useState<Mode>("and");
  const nss = ["monitoring", "shop", "staging"];
  return (
    <Panel
      title="One dash, very different policy"
      right={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "and", label: "AND" },
            { value: "or", label: "OR" },
            { value: "any-ns", label: "namespaceSelector: {}" },
          ]}
        />
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Mono className="text-[11.5px]">{YAML[mode]}</Mono>
        <div className="space-y-3">
          {nss.map((ns) => (
            <div key={ns} className="rounded-lg border border-line p-2">
              <div className="mb-1.5 font-mono text-[10px] text-faint">ns/{ns}</div>
              <div className="flex flex-wrap gap-1.5">
                {PODS.filter((p) => p.ns === ns).map((p) => {
                  const m = matches(mode, p);
                  return (
                    <span
                      key={p.name}
                      className={clsx(
                        "rounded-md border px-2 py-1 font-mono text-[11px] transition-all duration-300",
                        m ? "border-ok/60 bg-ok/10 text-ok" : "border-line bg-panel-2 text-faint",
                      )}
                    >
                      {m ? "✓ " : ""}
                      {p.name}
                      <span className="ml-1 opacity-60">app={p.app}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          <p key={mode} className="animate-rise text-xs leading-relaxed text-muted">
            <b className="text-ink">{PODS.filter((p) => matches(mode, p)).length} pods</b> may reach the API. {EXPLAIN[mode]}
          </p>
        </div>
      </div>
    </Panel>
  );
}
