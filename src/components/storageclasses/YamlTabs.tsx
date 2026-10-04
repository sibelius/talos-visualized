"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Panel } from "../ui";

export type YamlTab = { id: string; label: string; color: string; note: ReactNode; code: ReactNode; talos?: ReactNode };

export function YamlTabs({ tabs }: { tabs: YamlTab[] }) {
  const [id, setId] = useState(tabs[0].id);
  const t = tabs.find((x) => x.id === id)!;
  return (
    <Panel
      title="StorageClass manifests"
      right={
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="StorageClass examples">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === id}
              onClick={() => setId(x.id)}
              className={clsx(
                "rounded-md px-2 py-1 font-mono text-[11px] transition",
                x.id === id ? "bg-bg text-ink" : "text-muted hover:text-ink",
              )}
              style={x.id === id ? { boxShadow: `inset 0 -2px 0 ${x.color}` } : undefined}
            >
              {x.label}
            </button>
          ))}
        </div>
      }
    >
      <div key={t.id} className="animate-rise space-y-3">
        <p className="text-sm leading-relaxed text-muted">{t.note}</p>
        <div className={clsx("grid gap-3", t.talos && "xl:grid-cols-2")}>
          {t.code}
          {t.talos}
        </div>
      </div>
    </Panel>
  );
}
