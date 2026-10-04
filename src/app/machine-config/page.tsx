import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { PatchMerge } from "@/components/machine-config/PatchMerge";
import { ApplyModes } from "@/components/machine-config/ApplyModes";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/machine-config");

const MACHINE = [
  ["type", "controlplane or worker. Decides whether etcd and the control-plane static pods run."],
  ["token / ca", "The machine token and Talos API CA: how nodes join (via trustd) and how apid trusts clients."],
  ["certSANs", "Extra names/IPs in the Talos API certificate."],
  ["kubelet", "Image (= Kubernetes version), extraArgs, extraMounts, nodeIP selection."],
  ["network", "Hostname, interfaces (static addresses, bonds, VLANs, VIP), routes, nameservers."],
  ["install", "Target disk (or diskSelector) and installer image. Used at install and upgrade."],
  ["features", "KubePrism, hostDNS, RBAC for the Talos API, Talos API access from pods…"],
  ["sysctls, kernel, files, registries", "Node-level tuning, kernel modules, registry mirrors and auth."],
];
const CLUSTER = [
  ["controlPlane.endpoint", "The URL every kubelet and client uses for the API server: a VIP, load balancer or DNS name, never one node."],
  ["clusterName", "Name baked into kubeconfig and certs."],
  ["network", "cni (flannel / none / custom URLs), podSubnets, serviceSubnets, dnsDomain."],
  ["proxy", "kube-proxy settings, or disabled: true when a CNI replaces it."],
  ["apiServer / controllerManager / scheduler", "Images, extraArgs, certSANs, admission config for the static pods."],
  ["etcd", "CA, extraArgs, advertisedSubnets for multi-homed nodes."],
  ["discovery", "Discovery registries used for node membership (and KubeSpan)."],
  ["secrets", "ca, aggregatorCA, serviceAccount key, secretboxEncryptionSecret, bootstrap token: the cluster's identity."],
];

export default async function Page() {
  return (
    <>
      <PageHeader n="02" title="Machine config">
        A Talos node is defined by one YAML document: the machine config. It holds everything a traditional node spreads
        across cloud-init, /etc, systemd units and kubeadm flags: node identity, network, disk, kubelet settings and the
        cluster&apos;s PKI. You generate it once from a set of secrets, customise it with small patches, and push it with{" "}
        <code className="font-mono text-ink">talosctl apply-config</code>. Same inputs, same node, every time.
      </PageHeader>

      <Panel title="From secrets to three files">
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1.2fr_auto_1.4fr]">
          <FlowBox title="secrets.yaml" sub="talosctl gen secrets" body="CAs, keys, tokens. The only thing that must stay secret and stable: regenerate it and you have a different cluster." tone="var(--color-bad)" />
          <Arrow />
          <FlowBox title="gen config" sub="cluster name + endpoint + patches" body="Deterministic: same secrets and patches always yield the same configs." tone="var(--color-accent)" />
          <Arrow />
          <div className="grid gap-2">
            <FlowBox title="controlplane.yaml" sub="machine.type: controlplane" tone="var(--color-f4)" />
            <FlowBox title="worker.yaml" sub="machine.type: worker" tone="var(--color-f2)" />
            <FlowBox title="talosconfig" sub="client cert for talosctl (os:admin)" tone="var(--color-f1)" />
          </div>
        </div>
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="generate"
          code={`talosctl gen secrets -o secrets.yaml        # keep this in a vault / SOPS

talosctl gen config homelab https://10.0.0.5:6443 \\
  --with-secrets secrets.yaml \\
  --config-patch @patches/install.yaml \\
  --config-patch-control-plane @patches/cilium.yaml \\
  --output-dir _out

talosctl validate --config _out/controlplane.yaml --mode metal`}
        />
        <Code
          title="per-node patches, after generation"
          code={`# render a node-specific file (no secrets in git if you template them)
talosctl machineconfig patch _out/controlplane.yaml \\
  --patch @nodes/cp-1.yaml -o cp-1.yaml

# or patch a running node in place
talosctl -n 10.0.0.10 patch machineconfig --patch @nodes/cp-1.yaml

# or open the live config in $EDITOR
talosctl -n 10.0.0.10 edit machineconfig`}
        />
      </div>

      <Section title="Two halves: machine and cluster" kicker="v1alpha1 anatomy">
        <code className="font-mono">machine:</code> is about this node. <code className="font-mono">cluster:</code> is about the
        Kubernetes cluster and is identical across nodes (workers get a trimmed copy without the CA keys).
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Anatomy title="machine:" rows={MACHINE} color="var(--color-accent)" />
        <Anatomy title="cluster:" rows={CLUSTER} color="var(--color-accent-2)" />
      </div>

      <Section title="Patches: small, composable, reviewable" kicker="strategic merge">
        Instead of editing a 300-line generated file, keep a handful of small patches in git and merge them in. Maps merge
        key by key, scalars are replaced, lists are appended (network interfaces are matched by name or selector), and{" "}
        <code className="font-mono">$patch: delete</code> removes a key. Toggle patches and watch the merged config; each
        highlighted line is colored by the patch that introduced it.
      </Section>
      <Panel title="Strategic-merge playground">
        <PatchMerge />
      </Panel>
      <div className="mt-4">
        <Callout title="Beyond one document">
          Since Talos 1.5 a config file can contain several YAML documents separated by <code className="font-mono">---</code>:
          the classic <code className="font-mono">v1alpha1</code> document plus typed documents such as{" "}
          <code className="font-mono">ExtensionServiceConfig</code>, and in newer releases{" "}
          <code className="font-mono">VolumeConfig</code> / <code className="font-mono">UserVolumeConfig</code> for disk layout.
          Recent releases keep moving settings (e.g. parts of networking) into their own documents. Patches can target
          either kind.
        </Callout>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="patches/cilium.yaml"
          lang="yaml"
          code={`cluster:
  network:
    cni:
      name: none      # Talos won't deploy flannel
  proxy:
    disabled: true    # Cilium replaces kube-proxy
machine:
  features:
    kubePrism:
      enabled: true   # default in generated configs
      port: 7445      # Cilium's k8sServiceHost=localhost, k8sServicePort=7445`}
        />
        <Code
          title="a multi-document patch"
          lang="yaml"
          code={`machine:
  nodeLabels:
    node.kubernetes.io/storage: longhorn
---
apiVersion: v1alpha1
kind: UserVolumeConfig
name: longhorn
provisioning:
  diskSelector:
    match: disk.transport == "nvme"
  minSize: 100GiB
---
apiVersion: v1alpha1
kind: ExtensionServiceConfig
name: nut-client
environment:
  - UPS_HOST=10.0.0.2`}
        />
      </div>

      <Section title="Applying a change: does it need a reboot?" kicker="apply-config --mode">
        Most of the config (network, kubelet, labels, sysctls, the whole <code className="font-mono">cluster:</code> section)
        is reconciled live by machined&apos;s controllers. A few fields only take effect at boot. The mode decides what
        happens when you mix them.
      </Section>
      <Panel title="Apply modes">
        <ApplyModes />
      </Panel>
      <div className="mt-4">
        <Code
          title="first apply vs later applies"
          code={`# maintenance mode (fresh ISO boot): no certs yet, so --insecure
talosctl apply-config --insecure -n 10.0.0.10 -f cp-1.yaml

# afterwards: authenticated, and preview first
talosctl -n 10.0.0.10 apply-config -f cp-1.yaml --dry-run
talosctl -n 10.0.0.10 apply-config -f cp-1.yaml --mode try --timeout 2m`}
        />
      </div>

      <Takeaways
        items={[
          <span key="t1">secrets.yaml is the cluster&apos;s identity; everything else is derived. Back it up, and you can regenerate every node config at will.</span>,
          <span key="t2">Patches keep intent small and reviewable: &quot;use Cilium&quot;, &quot;static IP for cp-1&quot;. The generated base can change between Talos versions without merge conflicts in your repo.</span>,
          <span key="t3">Most changes apply live because machined reconciles them; use --dry-run to see the diff and --mode try for changes that could cut you off.</span>,
        ]}
      />
    </>
  );
}

function FlowBox({ title, sub, body, tone }: { title: string; sub: string; body?: string; tone: string }) {
  return (
    <div className="rounded-lg border bg-panel-2/60 p-3" style={{ borderColor: `color-mix(in srgb, ${tone} 45%, transparent)` }}>
      <div className="font-mono text-sm" style={{ color: tone }}>
        {title}
      </div>
      <div className="font-mono text-[11px] text-faint">{sub}</div>
      {body && <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{body}</p>}
    </div>
  );
}

function Arrow() {
  return (
    <div className="text-center text-faint" aria-hidden>
      <span className="hidden md:inline">→</span>
      <span className="md:hidden">↓</span>
    </div>
  );
}

function Anatomy({ title, rows, color }: { title: string; rows: string[][]; color: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 font-mono text-sm" style={{ color }}>
        {title}
      </div>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-x-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
            <dt className="font-mono text-[12px] text-ink">{k}</dt>
            <dd className="text-[13px] leading-snug text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
