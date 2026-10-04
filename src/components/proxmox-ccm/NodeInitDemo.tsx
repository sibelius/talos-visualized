"use client";

import { useState } from "react";
import clsx from "clsx";
import { Callout, Panel, Pill, Segmented, Toggle } from "@/components/ui";
import { EventLog, HostBox, LiveText, StepControls, StepList, VmChip, useStepper, type YLine } from "@/components/proxmox/parts";

type Vm = { name: string; vmid: number; host: string; cores: number; memGb: number; ip: string; uuid: string };

const VMS: Vm[] = [
  { name: "cp-1", vmid: 101, host: "pve1", cores: 4, memGb: 8, ip: "10.0.0.11", uuid: "0b0e8a2c-…-c1" },
  { name: "worker-1", vmid: 111, host: "pve1", cores: 4, memGb: 8, ip: "10.0.0.21", uuid: "4f6a1d0e-5b7c-4e19-9a0b-2c55e1a7d911" },
  { name: "cp-2", vmid: 102, host: "pve2", cores: 4, memGb: 8, ip: "10.0.0.12", uuid: "71c4…-c2" },
  { name: "worker-2", vmid: 112, host: "pve2", cores: 4, memGb: 8, ip: "10.0.0.22", uuid: "9d2e7b13-08aa-4c4e-b6f1-6a3f0c8e2b42" },
  { name: "cp-3", vmid: 103, host: "pve3", cores: 4, memGb: 8, ip: "10.0.0.13", uuid: "a3f9…-c3" },
  { name: "worker-3", vmid: 113, host: "pve3", cores: 8, memGb: 16, ip: "10.0.0.23", uuid: "e1b85c47-2f6d-4d0a-8c3e-7f9a4b6d5c13" },
];
const HOSTS = ["pve1", "pve2", "pve3"];
const JOINERS = ["worker-1", "worker-2", "worker-3"] as const;

const STEPS_EXT = [
  { who: "kubelet", title: "Registers the Node with the uninitialized taint" },
  { who: "ccm", title: "cloud-node finds the VM: name prefix + SMBIOS UUID" },
  { who: "ccm", title: "Reads the VM config from the Proxmox API" },
  { who: "ccm", title: "Patches providerID, labels, addresses" },
  { who: "ccm", title: "Removes the uninitialized taint" },
  { who: "scheduler", title: "Pending pods can land on the node" },
];
const STEPS_NOEXT = [
  { who: "kubelet", title: "Registers the Node — no taint, no providerID" },
  { who: "ccm", title: "cloud-node ignores nodes it was not asked to initialize" },
  { who: "scheduler", title: "Pods schedule onto a node with no topology" },
  { who: "csi", title: "Zonal volumes have nothing to match against" },
];

function nodeYaml(vm: Vm, stage: number, external: boolean): YLine[] {
  const t = (s: string, tone?: YLine["tone"]): YLine => ({ t: s, tone });
  const L: YLine[] = [t("apiVersion: v1"), t("kind: Node"), t("metadata:"), t(`  name: ${vm.name}`), t("  annotations:")];
  L.push(t(`    alpha.kubernetes.io/provided-node-ip: ${vm.ip}`, "dim"));
  L.push(t("  labels:"));
  L.push(t(`    kubernetes.io/hostname: ${vm.name}`, "dim"));
  L.push(t("    kubernetes.io/os: linux", "dim"));
  const labeled = external && stage >= 3;
  if (labeled) {
    const n = stage === 3 ? "new" : undefined;
    L.push(t(`    node.kubernetes.io/instance-type: ${vm.cores}VCPU-${vm.memGb}GB`, n));
    L.push(t("    topology.kubernetes.io/region: cluster-1", n));
    L.push(t(`    topology.kubernetes.io/zone: ${vm.host}`, n));
    L.push(t("    topology.proxmox.sinextra.dev/region: cluster-1", n));
    L.push(t(`    topology.proxmox.sinextra.dev/zone: ${vm.host}`, n));
  }
  L.push(t("spec:"));
  if (labeled) L.push(t(`  providerID: proxmox://cluster-1/${vm.vmid}`, stage === 3 ? "new" : undefined));
  if (external) {
    if (stage <= 4) {
      L.push(t("  taints:", stage === 4 ? "del" : undefined));
      L.push(t("  - key: node.cloudprovider.kubernetes.io/uninitialized", stage === 4 ? "del" : "warn"));
      L.push(t('    value: "true"', stage === 4 ? "del" : "warn"));
      L.push(t("    effect: NoSchedule", stage === 4 ? "del" : "warn"));
    }
  } else {
    L.push(t("  # no taint: kubelet thinks no cloud provider exists", "dim"));
  }
  L.push(t("status:"));
  L.push(t("  addresses:"));
  if (labeled || !external) {
    L.push(t(`  - type: InternalIP`, external && stage === 3 ? "new" : undefined));
    L.push(t(`    address: ${vm.ip}`, external && stage === 3 ? "new" : undefined));
  }
  L.push(t("  - type: Hostname"));
  L.push(t(`    address: ${vm.name}`));
  L.push(t("  nodeInfo:"));
  L.push(t(`    systemUUID: ${vm.uuid}`, external && (stage === 1 || stage === 2) ? "warn" : undefined));
  return L;
}

export function NodeInitDemo() {
  const [who, setWho] = useState<(typeof JOINERS)[number]>("worker-3");
  const [external, setExternal] = useState(true);
  const steps = external ? STEPS_EXT : STEPS_NOEXT;
  const last = steps.length - 1;
  const s = useStepper(last, 1900);
  const stage = s.step;
  const vm = VMS.find((v) => v.name === who)!;

  const change = (fn: () => void) => {
    fn();
    s.reset();
  };

  const log: { who: string; msg: React.ReactNode; tone?: "ok" | "bad" | "warn" | "info" }[] = [];
  if (external) {
    log.push({ who: "kubelet", msg: `POST /api/v1/nodes ${vm.name} (--cloud-provider=external → adds uninitialized taint)`, tone: "warn" });
    if (stage >= 1) log.push({ who: "ccm", msg: `GET /cluster/resources?type=vm → match name^=${vm.name} && smbios uuid == ${vm.uuid.slice(0, 8)}…` });
    if (stage >= 1) log.push({ who: "pve", msg: `found vmid ${vm.vmid} on node ${vm.host} (region cluster-1)`, tone: "info" });
    if (stage >= 2) log.push({ who: "ccm", msg: `GET /nodes/${vm.host}/qemu/${vm.vmid}/config → cores=${vm.cores} memory=${vm.memGb * 1024}` });
    if (stage >= 3) log.push({ who: "ccm", msg: `PATCH node ${vm.name}: providerID=proxmox://cluster-1/${vm.vmid}, 5 labels, addresses`, tone: "ok" });
    if (stage >= 4) log.push({ who: "ccm", msg: "remove taint node.cloudprovider.kubernetes.io/uninitialized", tone: "ok" });
    if (stage >= 5) log.push({ who: "scheduler", msg: `bound default/web-7d9c to ${vm.name}`, tone: "ok" });
  } else {
    log.push({ who: "kubelet", msg: `POST /api/v1/nodes ${vm.name} (no --cloud-provider flag)` });
    if (stage >= 1) log.push({ who: "ccm", msg: "node has no uninitialized taint → not mine, skipping", tone: "warn" });
    if (stage >= 2) log.push({ who: "scheduler", msg: `bound default/web-7d9c to ${vm.name} (no zone label)` });
    if (stage >= 3) log.push({ who: "csi", msg: "CreateVolume: zone must be provided (local storage)", tone: "bad" });
  }

  const podState = external
    ? stage >= 5
      ? { label: "Running", tone: "ok" as const }
      : { label: "Pending: untolerated taint uninitialized", tone: "warn" as const }
    : stage >= 2
      ? { label: "Running — but with no topology", tone: "warn" as const }
      : { label: "Pending", tone: "warn" as const };

  const scanning = external && stage === 1;
  const matched = external && stage >= 1;

  return (
    <Panel
      title="Node initialization, step by step"
      right={
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={who} options={JOINERS} onChange={(v) => change(() => setWho(v))} />
          <Toggle checked={external} onChange={(v) => change(() => setExternal(v))} label={<span className="font-mono text-xs">--cloud-provider=external</span>} />
        </div>
      }
    >
      <div className="mb-4">
        <StepControls s={s} last={last} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)]">
        <StepList steps={steps} current={stage} onPick={s.setStep} />

        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-line p-2">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
              <span className="text-ink">Proxmox cluster <span className="text-accent">cluster-1</span></span>
              <span className="text-faint">= region</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {HOSTS.map((h) => (
                <HostBox key={h} name={h} active={matched && vm.host === h}>
                  {VMS.filter((v) => v.host === h).map((v) => {
                    const isMe = v.name === who;
                    return (
                      <VmChip
                        key={v.vmid}
                        name={v.name}
                        vmid={v.vmid}
                        tone={isMe && matched ? "active" : isMe ? "default" : "default"}
                        className={clsx(scanning && !isMe && "animate-pulse-soft", isMe && !matched && "ring-1 ring-info/50")}
                      />
                    );
                  })}
                </HostBox>
              ))}
            </div>
            <div className="mt-1 text-right font-mono text-[10px] text-faint">host name = zone</div>
          </div>

          <div className="flex items-center gap-2">
            <div className={clsx("flex-1 rounded-lg border px-3 py-2 transition", stage >= 1 && external && stage <= 4 ? "border-accent-2 bg-accent-2/10" : "border-line bg-panel-2/50")}>
              <div className="font-mono text-[11px] text-ink">proxmox-cloud-controller-manager</div>
              <div className="font-mono text-[10px] text-faint">controllers: cloud-node, cloud-node-lifecycle</div>
            </div>
            <svg width="40" height="20" viewBox="0 0 40 20" aria-hidden className="shrink-0">
              <path d="M2 10 H38" stroke={stage >= 1 && external && stage <= 4 ? "var(--color-accent-2)" : "var(--color-line)"} strokeWidth="2" strokeDasharray="6 6" className={stage >= 1 && external && stage <= 4 ? "animate-dash" : ""} />
            </svg>
            <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 font-mono text-[11px] text-muted">kube-apiserver</div>
          </div>

          <EventLog items={log} />

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-mono text-ink">pod web-7d9c</span>
            <Pill color={podState.tone === "ok" ? "var(--color-ok)" : "var(--color-warn)"}>{podState.label}</Pill>
          </div>
        </div>

        <LiveText title={`kubectl get node ${vm.name} -o yaml`} lines={nodeYaml(vm, stage, external)} />
      </div>

      <div className="mt-4">
        {external ? (
          <Callout tone="info" title="How the VM is found">
            On first sight the Node has no <code className="font-mono text-ink">providerID</code>, so the CCM lists VMs in every configured Proxmox
            cluster and keeps the one whose name starts with the node name <em>and</em> whose SMBIOS UUID equals{" "}
            <code className="font-mono text-ink">status.nodeInfo.systemUUID</code>. Once written, <code className="font-mono text-ink">providerID</code>{" "}
            is immutable and every later lookup goes straight to <code className="font-mono text-ink">region/vmid</code>. The instance type is
            synthesized from the VM&apos;s cores and memory.
          </Callout>
        ) : (
          <Callout tone="warn" title="Without the flag, nothing happens">
            The kubelet assumes no external cloud provider exists, so it never adds the taint, and the CCM skips the node. Fixing it later means
            deleting the Node object and restarting the kubelet. On Talos the flag comes from{" "}
            <code className="font-mono text-ink">cluster.externalCloudProvider.enabled: true</code>.
          </Callout>
        )}
      </div>
    </Panel>
  );
}
