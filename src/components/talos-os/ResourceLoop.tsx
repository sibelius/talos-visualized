"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Segmented } from "../ui";

type Res = { type: string; id: string; version: number; value: string; gone?: boolean };
type State = Record<string, Res>;
type Step = { from: string; to: string; text: string; apply?: (s: State) => State };

const INITIAL: State = {
  mc: { type: "MachineConfig", id: "v1alpha1", version: 4, value: "addresses: [10.0.0.17/24]" },
  spec: { type: "AddressSpec", id: "eth0/10.0.0.50/24", version: 0, value: "—", gone: true },
  status: { type: "AddressStatus", id: "eth0/10.0.0.50/24", version: 0, value: "—", gone: true },
  link: { type: "LinkStatus", id: "eth0", version: 7, value: "operState: up" },
  node: { type: "NodeAddress", id: "current", version: 3, value: "[10.0.0.17/24]" },
};

const bump = (s: State, k: string, patch: Partial<Res>): State => ({ ...s, [k]: { ...s[k], ...patch, version: s[k].version + 1 } });

const SCENARIOS: Record<string, { label: string; needs?: "added"; steps: Step[] }> = {
  add: {
    label: "patch config: add 10.0.0.50/24",
    steps: [
      { from: "you", to: "mc", text: "talosctl patch mc writes a new MachineConfig resource. Nothing else is touched directly.", apply: (s) => bump(s, "mc", { value: "addresses: [10.0.0.17/24, 10.0.0.50/24]" }) },
      { from: "mc", to: "c-cfg", text: "AddressConfigController watches MachineConfig, wakes up, and derives the addresses the config asks for." },
      { from: "c-cfg", to: "spec", text: "It writes an AddressSpec (desired state). Other sources (DHCP, platform metadata) write their own layers; a merge controller combines them.", apply: (s) => bump(s, "spec", { gone: false, value: "layer: configuration" }) },
      { from: "spec", to: "c-spec", text: "AddressSpecController sees a spec with no matching kernel address…" },
      { from: "c-spec", to: "kernel", text: "…and calls netlink RTM_NEWADDR on eth0. This is the only step that touches the OS." },
      { from: "kernel", to: "c-status", text: "The kernel emits a netlink event; AddressStatusController observes actual state." },
      { from: "c-status", to: "status", text: "AddressStatus records what really exists (talosctl get addresses).", apply: (s) => bump(s, "status", { gone: false, value: "scope: global, flags: permanent" }) },
      { from: "status", to: "node", text: "NodeAddressController recomputes the node's addresses, which kubelet and discovery consume. Converged.", apply: (s) => bump(s, "node", { value: "[10.0.0.17/24, 10.0.0.50/24]" }) },
    ],
  },
  drift: {
    label: "drift: someone runs ip addr del",
    needs: "added",
    steps: [
      { from: "you", to: "kernel", text: "A privileged pod deletes 10.0.0.50 behind Talos's back (RTM_DELADDR)." },
      { from: "kernel", to: "c-status", text: "AddressStatusController sees the netlink event." },
      { from: "c-status", to: "status", text: "AddressStatus is removed: actual state no longer matches desired.", apply: (s) => bump(s, "status", { gone: true, value: "—" }) },
      { from: "spec", to: "c-spec", text: "AddressSpec still says the address should exist, so AddressSpecController reconciles…" },
      { from: "c-spec", to: "kernel", text: "…and re-adds it. No cron job, no config-management run: the loop itself repairs drift." },
      { from: "kernel", to: "c-status", text: "New netlink event observed." },
      { from: "c-status", to: "status", text: "AddressStatus is back. Desired == actual again.", apply: (s) => bump(s, "status", { gone: false, value: "scope: global, flags: permanent" }) },
    ],
  },
  link: {
    label: "cable unplugged",
    steps: [
      { from: "you", to: "kernel", text: "The NIC loses carrier. The kernel emits RTM_NEWLINK with operstate down." },
      { from: "kernel", to: "c-link", text: "LinkStatusController observes the link change." },
      { from: "c-link", to: "link", text: "LinkStatus eth0 becomes down. Controllers that depend on links (routes, VIP, DHCP…) are woken up because they watch this resource.", apply: (s) => bump(s, "link", { value: "operState: down" }) },
      { from: "you", to: "kernel", text: "Cable is plugged back in." },
      { from: "kernel", to: "c-link", text: "Carrier is back; another event." },
      { from: "c-link", to: "link", text: "LinkStatus is up again; dependents converge again. Nobody restarted a 'network service'.", apply: (s) => bump(s, "link", { value: "operState: up" }) },
    ],
  },
};
type Key = keyof typeof SCENARIOS;

const CONTROLLERS = [
  { id: "c-cfg", name: "AddressConfigController" },
  { id: "c-spec", name: "AddressSpecController" },
  { id: "c-status", name: "AddressStatusController" },
  { id: "c-link", name: "LinkStatusController" },
];

export function ResourceLoop() {
  const [key, setKey] = useState<Key>("add");
  const [state, setState] = useState<State>(INITIAL);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [changed, setChanged] = useState<string | null>(null);
  const steps = SCENARIOS[key].steps;
  const cur = step >= 0 ? steps[step] : null;

  useEffect(() => {
    if (!playing) return;
    if (step >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => advance(), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, step]);

  function advance() {
    const next = step + 1;
    if (next >= steps.length) return;
    const st = steps[next];
    if (st.apply) {
      setState((s) => st.apply!(s));
      setChanged(st.to);
    } else setChanged(null);
    setStep(next);
  }

  function start(k: Key = key) {
    let s = state;
    if (SCENARIOS[k].needs === "added" && s.status.gone) {
      // make sure the address exists before simulating drift
      s = { ...s, spec: { ...s.spec, gone: false, value: "layer: configuration", version: Math.max(s.spec.version, 1) }, status: { ...s.status, gone: false, value: "scope: global, flags: permanent", version: Math.max(s.status.version, 1) }, mc: { ...s.mc, value: "addresses: [10.0.0.17/24, 10.0.0.50/24]" } };
      setState(s);
    }
    setStep(-1);
    setChanged(null);
    setPlaying(true);
  }

  const lit = (id: string) => cur != null && (cur.from === id || cur.to === id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Key>
          value={key}
          options={(Object.keys(SCENARIOS) as Key[]).map((k) => ({ value: k, label: SCENARIOS[k].label }))}
          onChange={(k) => {
            setKey(k);
            setStep(-1);
            setPlaying(false);
          }}
        />
        <Button variant="primary" onClick={() => start()} disabled={playing}>
          {playing ? "Reconciling…" : "▶ Trigger"}
        </Button>
        <Button variant="ghost" onClick={advance} disabled={playing || step >= steps.length - 1}>
          Step
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setState(INITIAL);
            setStep(-1);
            setChanged(null);
            setPlaying(false);
          }}
        >
          Reset
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1.1fr_1.6fr_0.9fr]">
        <Col title="inputs">
          <Node id="you" lit={lit("you")} label="you / the world" sub="talosctl, cables, pods" />
          <Node id="mc" lit={lit("mc")} label="MachineConfig" sub={`v${state.mc.version}`} accent="var(--color-accent)" />
        </Col>
        <Col title="controllers (in machined)">
          {CONTROLLERS.map((c) => (
            <Node key={c.id} id={c.id} lit={lit(c.id)} label={c.name} sub="watch → diff → act" mono accent="var(--color-f4)" />
          ))}
        </Col>
        <Col title="resources · talosctl get …">
          {(["spec", "status", "link", "node"] as const).map((k) => {
            const r = state[k];
            return (
              <div
                key={k + r.version}
                className={clsx(
                  "rounded-lg border px-2.5 py-1.5 transition-all duration-300",
                  lit(k) ? "border-f2 bg-f2/10" : "border-line bg-bg",
                  changed === k && "animate-flash",
                  r.gone && "opacity-40",
                )}
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11.5px]">
                  <span className="text-ink">{r.type}</span>
                  <span className="text-faint">v{r.version}</span>
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted">
                  {r.id} <span className="text-faint">· {r.gone ? "absent" : r.value}</span>
                </div>
              </div>
            );
          })}
        </Col>
        <Col title="kernel">
          <Node id="kernel" lit={lit("kernel")} label="Linux kernel" sub="netlink: eth0" accent="var(--color-info)" />
          <div className="rounded-lg border border-dashed border-line p-2 font-mono text-[10.5px] leading-snug whitespace-pre-line text-faint">
            eth0 {state.link.value.replace("operState: ", "")}
            <br />
            {!state.status.gone ? "10.0.0.17/24\n10.0.0.50/24" : "10.0.0.17/24"}
          </div>
        </Col>
      </div>

      <div className="flex min-h-14 items-start gap-3 rounded-lg border border-line bg-panel-2/50 p-3 text-sm text-muted" aria-live="polite">
        {cur ? (
          <>
            <span className="shrink-0 font-mono text-xs text-accent">
              {step + 1}/{steps.length}
            </span>
            <span>
              <span className="font-mono text-xs text-ink">
                {label(cur.from)} → {label(cur.to)}
              </span>
              <br />
              {cur.text}
            </span>
          </>
        ) : (
          <span>Pick an event and trigger it. Each controller only watches resources and writes resources; the chain emerges from those watches.</span>
        )}
      </div>
    </div>
  );
}

function label(id: string) {
  const c = CONTROLLERS.find((c) => c.id === id);
  if (c) return c.name;
  return { you: "event", mc: "MachineConfig", kernel: "kernel", spec: "AddressSpec", status: "AddressStatus", link: "LinkStatus", node: "NodeAddress" }[id] ?? id;
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10.5px] tracking-wide text-faint uppercase">{title}</div>
      {children}
    </div>
  );
}

function Node({ lit, label, sub, mono, accent = "var(--color-accent)" }: { id: string; lit: boolean; label: string; sub?: string; mono?: boolean; accent?: string }) {
  return (
    <div
      className="rounded-lg border px-2.5 py-1.5 transition-all duration-300"
      style={{
        borderColor: lit ? accent : "var(--color-line)",
        background: lit ? `color-mix(in srgb, ${accent} 14%, var(--color-panel-2))` : "var(--color-panel-2)",
      }}
    >
      <div className={clsx("truncate text-[12px] text-ink", mono && "font-mono text-[11px]")}>{label}</div>
      {sub && <div className="text-[10.5px] text-faint">{sub}</div>}
    </div>
  );
}
