"use client";

import { useState } from "react";
import clsx from "clsx";
import { Panel, Segmented } from "../ui";

type Anp = "none" | "Allow" | "Deny" | "Pass";
type Np = "none" | "allows" | "no-match";
type Banp = "none" | "Allow" | "Deny";

type Step = { tier: 0 | 1 | 2 | 3; text: string; final?: "allow" | "deny" };

function walk(anp: Anp, np: Np, banp: Banp): Step[] {
  const s: Step[] = [];
  if (anp === "Allow") return [{ tier: 0, text: "An AdminNetworkPolicy rule matches with action Allow — accepted. Namespace NetworkPolicies are never consulted.", final: "allow" }];
  if (anp === "Deny") return [{ tier: 0, text: "An AdminNetworkPolicy rule matches with action Deny — dropped. No namespace policy can re-open it.", final: "deny" }];
  s.push({ tier: 0, text: anp === "Pass" ? "ANP rule matches with action Pass — skip the remaining admin rules, let the namespace owner decide." : "No AdminNetworkPolicy rule matches — fall through." });
  if (np === "allows") return [...s, { tier: 1, text: "The pod is selected by a NetworkPolicy and one of its rules matches — allowed.", final: "allow" }];
  if (np === "no-match") return [...s, { tier: 1, text: "The pod is isolated by a NetworkPolicy but no rule matches — dropped (implicit deny).", final: "deny" }];
  s.push({ tier: 1, text: "No NetworkPolicy selects the pod for this direction — it is not isolated, fall through." });
  if (banp === "Allow") return [...s, { tier: 2, text: "BaselineAdminNetworkPolicy rule matches with Allow — accepted.", final: "allow" }];
  if (banp === "Deny") return [...s, { tier: 2, text: "BaselineAdminNetworkPolicy rule matches with Deny — dropped. This is the cluster-wide 'default deny unless the team opts in' guardrail.", final: "deny" }];
  return [...s, { tier: 2, text: "No baseline rule matches." }, { tier: 3, text: "Kubernetes default: allow.", final: "allow" }];
}

const TIERS = [
  { name: "AdminNetworkPolicy", who: "cluster admin · priority-ordered · Allow / Deny / Pass" },
  { name: "NetworkPolicy", who: "namespace owner · allow-list only" },
  { name: "BaselineAdminNetworkPolicy", who: "cluster admin · singleton 'default' · Allow / Deny" },
  { name: "default", who: "allow everything" },
];

export function TierStack() {
  const [anp, setAnp] = useState<Anp>("none");
  const [np, setNp] = useState<Np>("none");
  const [banp, setBanp] = useState<Banp>("Deny");
  const steps = walk(anp, np, banp);
  const last = steps[steps.length - 1];
  return (
    <Panel title="Evaluation order: admin tiers around NetworkPolicy">
      <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
        <div className="space-y-3 text-xs text-muted">
          <div>
            <div className="mb-1">AdminNetworkPolicy rule</div>
            <Segmented value={anp} onChange={setAnp} options={["none", "Allow", "Deny", "Pass"] as const} />
          </div>
          <div>
            <div className="mb-1">NetworkPolicy</div>
            <Segmented
              value={np}
              onChange={setNp}
              options={[
                { value: "none", label: "none selects pod" },
                { value: "allows", label: "allows" },
                { value: "no-match", label: "isolates, no match" },
              ]}
            />
          </div>
          <div>
            <div className="mb-1">BaselineAdminNetworkPolicy rule</div>
            <Segmented value={banp} onChange={setBanp} options={["none", "Allow", "Deny"] as const} />
          </div>
        </div>
        <ol className="space-y-2">
          {TIERS.map((t, i) => {
            const step = steps.find((s) => s.tier === i);
            const visited = !!step;
            const decided = step?.final;
            return (
              <li
                key={t.name}
                className={clsx(
                  "rounded-lg border px-3 py-2 transition-all duration-300",
                  !visited && "border-line opacity-35",
                  visited && !decided && "border-line bg-panel-2",
                  decided === "allow" && "border-ok/60 bg-ok/10",
                  decided === "deny" && "border-bad/60 bg-bad/10",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-ink">
                    {i + 1}. {t.name}
                  </span>
                  <span className="text-[10px] text-faint">{t.who}</span>
                </div>
                {step && <p className="mt-1 animate-rise text-xs text-muted">{step.text}</p>}
              </li>
            );
          })}
          <li className={clsx("pt-1 font-mono text-sm", last.final === "allow" ? "text-ok" : "text-bad")}>
            → {last.final === "allow" ? "ALLOWED" : "DROPPED"}
          </li>
        </ol>
      </div>
    </Panel>
  );
}
