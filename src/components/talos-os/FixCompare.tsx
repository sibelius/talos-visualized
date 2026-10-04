"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Button, Segmented, Stat } from "../ui";

type Step = { cmd: string; note: string; risk?: boolean };
type Scenario = { label: string; problem: string; trad: Step[]; talos: Step[] };

const SCENARIOS: Record<string, Scenario> = {
  kubelet: {
    label: "kubelet flapping",
    problem: "A node goes NotReady. The kubelet keeps restarting after someone set a bad flag.",
    trad: [
      { cmd: "ssh admin@node-7", note: "needs an SSH daemon, keys and a user on every node" },
      { cmd: "sudo systemctl status kubelet", note: "inspect the unit" },
      { cmd: "sudo journalctl -u kubelet -n 200", note: "read the logs" },
      { cmd: "sudo vim /var/lib/kubelet/config.yaml", note: "hand-edit a file on one node", risk: true },
      { cmd: "sudo systemctl restart kubelet", note: "node-7 now differs from its siblings", risk: true },
    ],
    talos: [
      { cmd: "talosctl -n 10.0.0.17 service kubelet", note: "service state + recent events, over the API" },
      { cmd: "talosctl -n 10.0.0.17 logs kubelet", note: "same log stream, no shell" },
      { cmd: "vim patches/kubelet.yaml  # in git", note: "fix the declared config, not the node" },
      { cmd: "talosctl -n 10.0.0.17 patch mc --patch @patches/kubelet.yaml", note: "machined restarts kubelet with the new config — no reboot" },
    ],
  },
  module: {
    label: "need iSCSI",
    problem: "Longhorn needs iscsiadm and the iscsi kernel modules on every worker.",
    trad: [
      { cmd: "ssh admin@node-7", note: "repeat for every node" },
      { cmd: "sudo apt-get install -y open-iscsi", note: "mutates the root filesystem", risk: true },
      { cmd: "sudo systemctl enable --now iscsid", note: "another unit to keep alive" },
      { cmd: "sudo modprobe iscsi_tcp", note: "and remember to persist it in /etc/modules-load.d", risk: true },
    ],
    talos: [
      { cmd: "# add siderolabs/iscsi-tools to the schematic", note: "a system extension = a signed, versioned layer" },
      { cmd: "curl -X POST --data-binary @schematic.yaml https://factory.talos.dev/schematics", note: "returns the schematic ID" },
      { cmd: "talosctl -n 10.0.0.17 upgrade --image factory.talos.dev/installer/<id>:v1.11.3", note: "new image to the inactive slot, reboot, rollback if it fails" },
    ],
  },
  disk: {
    label: "disk filling up",
    problem: "DiskPressure on a node. What is eating /var?",
    trad: [
      { cmd: "ssh admin@node-7", note: "" },
      { cmd: "df -h && sudo du -sh /var/* | sort -h", note: "classic triage" },
      { cmd: "sudo rm -rf /var/log/old-*.gz", note: "ad-hoc cleanup nobody records", risk: true },
      { cmd: "sudo crictl rmi --prune", note: "" },
    ],
    talos: [
      { cmd: "talosctl -n 10.0.0.17 get volumestatus", note: "EPHEMERAL size and usage as a resource" },
      { cmd: "talosctl -n 10.0.0.17 usage /var --depth 2", note: "du over the API" },
      { cmd: "talosctl -n 10.0.0.17 dashboard", note: "live TUI: CPU, memory, processes, logs" },
    ],
  },
  dns: {
    label: "change DNS servers",
    problem: "The upstream resolvers changed; every node must use 10.0.0.53.",
    trad: [
      { cmd: "ssh admin@node-7", note: "×N nodes, or an Ansible run" },
      { cmd: "sudo vim /etc/netplan/01-net.yaml", note: "distro-specific network stack", risk: true },
      { cmd: "sudo netplan apply", note: "hope DHCP or cloud-init won't overwrite it later", risk: true },
    ],
    talos: [
      { cmd: "talosctl -n 10.0.0.17 patch mc --patch @dns.yaml", note: "machine.network.nameservers: [10.0.0.53]" },
      { cmd: "talosctl -n 10.0.0.17 get resolvers", note: "the network controllers converge; verify the resulting resource" },
    ],
  },
};

type Key = keyof typeof SCENARIOS;

export function FixCompare() {
  const [key, setKey] = useState<Key>("kubelet");
  const [shown, setShown] = useState(0);
  const s = SCENARIOS[key];
  const total = Math.max(s.trad.length, s.talos.length);

  useEffect(() => {
    if (shown === 0 || shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), 700);
    return () => clearTimeout(t);
  }, [shown, total]);

  const drift = s.trad.filter((x) => x.risk).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Key> value={key} options={(Object.keys(SCENARIOS) as Key[]).map((k) => ({ value: k, label: SCENARIOS[k].label }))} onChange={(k) => {
            setKey(k);
            setShown(0);
          }}
        />
        <Button variant="primary" onClick={() => setShown(1)}>
          ▶ Play both
        </Button>
        <Button variant="ghost" onClick={() => setShown(total)}>
          Show all
        </Button>
      </div>
      <p className="text-sm text-muted">
        <span className="text-ink">Incident:</span> {s.problem}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Column title="Traditional node" subtitle="SSH + package manager + mutable files" steps={s.trad} shown={shown} tone="bad" />
        <Column title="Talos node" subtitle="talosctl + declarative config" steps={s.talos} shown={shown} tone="ok" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="steps (trad)" value={s.trad.length} />
        <Stat label="steps (talos)" value={s.talos.length} />
        <Stat label="drift introduced" value={drift} tone={drift ? "bad" : "good"} />
        <Stat label="drift on talos" value={0} tone="good" />
      </div>
    </div>
  );
}

function Column({ title, subtitle, steps, shown, tone }: { title: string; subtitle: string; steps: Step[]; shown: number; tone: "ok" | "bad" }) {
  return (
    <div className={clsx("rounded-xl border bg-panel-2/40 p-3", tone === "ok" ? "border-ok/30" : "border-bad/30")}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={clsx("text-sm font-medium", tone === "ok" ? "text-ok" : "text-bad")}>{title}</span>
        <span className="text-[11px] text-faint">{subtitle}</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((st, i) => (
          <li
            key={st.cmd + i}
            className={clsx(
              "rounded-lg border px-2.5 py-1.5 transition-all duration-500",
              i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-15",
              st.risk ? "border-bad/40 bg-bad/5" : "border-line bg-bg",
            )}
          >
            <code className="block font-mono text-[11.5px] break-all text-ink">{st.cmd}</code>
            {st.note && <span className={clsx("text-[11px]", st.risk ? "text-bad" : "text-faint")}>{st.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
