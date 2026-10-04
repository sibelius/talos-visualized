import { Callout, PageHeader, Panel, Section, Takeaways } from "@/components/ui";
import { Code } from "@/components/code/Code";
import { ABUpgrade } from "@/components/upgrades/ABUpgrade";
import { RollingUpgrade } from "@/components/upgrades/RollingUpgrade";
import { K8sUpgrade } from "@/components/upgrades/K8sUpgrade";
import { SchematicBuilder } from "@/components/upgrades/SchematicBuilder";
import { pageMetadata } from "@/lib/og";

export const metadata = pageMetadata("/upgrades");

export default async function Page() {
  return (
    <>
      <PageHeader n="04" title="Upgrades & Image Factory">
        You never upgrade packages on Talos: you replace the whole OS image. A new kernel and initramfs are written to the
        inactive boot slot, the node reboots into them, and if that fails the previous slot is still there. Kubernetes is
        upgraded separately, without reboots. And because there&apos;s no package manager, anything extra (drivers, iSCSI
        tools, a guest agent) is baked into the image by Image Factory as a system extension.
      </PageHeader>

      <Panel title="A/B upgrade of one node">
        <ABUpgrade />
      </Panel>

      <Section title="Rolling through a cluster" kicker="one node at a time">
        Talos upgrades are per node, so the order and pace are yours. The usual pattern is control planes one at a time,
        each back to Ready (and etcd healthy) before the next, then workers in batches small enough for your
        PodDisruptionBudgets. Talos refuses to upgrade a control plane when etcd is already degraded, unless you pass{" "}
        <code className="font-mono">--force</code>.
      </Section>
      <Panel title="Rolling upgrade planner">
        <RollingUpgrade />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="upgrade Talos"
          code={`# one node at a time; waits and streams progress by default
talosctl -n 10.0.0.10 upgrade \\
  --image factory.talos.dev/installer/<schematic-id>:v1.11.3

talosctl -n 10.0.0.10 version          # confirm server version
talosctl -n 10.0.0.10 health           # before moving to the next node

# changed your mind / new image misbehaves after booting
talosctl -n 10.0.0.10 rollback`}
        />
        <Callout tone="warn" title="Version paths">
          Upgrade Talos through each minor release (e.g. 1.10.x → 1.11.x → 1.12.x), landing on the latest patch of each,
          rather than skipping minors. Check that your Kubernetes version is supported by the target Talos release before
          you start; upgrade Kubernetes separately with <code className="font-mono">upgrade-k8s</code>.
        </Callout>
      </div>

      <Section title="Upgrading Kubernetes is a different command" kicker="talosctl upgrade-k8s">
        The Talos image and the Kubernetes version are independent. <code className="font-mono">upgrade-k8s</code> walks the
        cluster, updating each control-plane static pod and then each kubelet through the Talos API, waiting for health at
        every step. No node reboots.
      </Section>
      <Panel title="upgrade-k8s, component by component">
        <K8sUpgrade />
      </Panel>
      <div className="mt-4">
        <Code
          title="kubernetes upgrade"
          code={`talosctl -n 10.0.0.10 upgrade-k8s --to 1.34.1 --dry-run   # show what would change
talosctl -n 10.0.0.10 upgrade-k8s --to 1.34.1`}
        />
      </div>

      <Section title="Image Factory: the OS image you need, built on demand" kicker="schematics & system extensions">
        The root filesystem is read-only, so a driver or host tool can&apos;t be installed later; it has to be part of the
        image. A <em>schematic</em> describes your customisations (official system extensions, extra kernel args). POST it to
        Image Factory and you get back an ID that is a hash of its content. That ID, plus a Talos version, names every
        artifact: installer image, ISO, disk images, PXE.
      </Section>
      <Panel title="Build a schematic">
        <SchematicBuilder />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Code
          title="register a schematic"
          code={`cat > schematic.yaml <<'EOF'
customization:
  systemExtensions:
    officialExtensions:
      - siderolabs/iscsi-tools
      - siderolabs/qemu-guest-agent
      - siderolabs/util-linux-tools
EOF

curl -X POST --data-binary @schematic.yaml https://factory.talos.dev/schematics
# {"id":"<64 hex chars>"}`}
        />
        <Code
          title="use it"
          lang="yaml"
          code={`# install & every future upgrade use the same schematic
machine:
  install:
    disk: /dev/vda
    image: factory.talos.dev/installer/<schematic-id>:v1.11.3

# check what's loaded on a node
#   talosctl -n 10.0.0.21 get extensions`}
        />
      </div>
      <div className="mt-4">
        <Callout title="Extensions are versioned with Talos">
          Each official extension is built for a specific Talos release, and the factory picks the matching build. That&apos;s
          why upgrades go through the factory image: a plain <code className="font-mono">ghcr.io/siderolabs/installer</code> image
          would silently drop your extensions. Newer releases also publish platform-specific installers
          (e.g. <code className="font-mono">nocloud-installer</code>), which the builder above shows.
        </Callout>
      </div>

      <Takeaways
        items={[
          <span key="t1">Whole-image A/B upgrades make every upgrade atomic and reversible: the node is either on the old image or the new one, never half-patched.</span>,
          <span key="t2">Keep etcd quorum by upgrading control planes strictly one at a time; Talos&apos;s health check enforces it unless forced.</span>,
          <span key="t3">The schematic ID pins exactly which extensions a node runs. Commit it next to your machine config and every rebuild is reproducible.</span>,
        ]}
      />
    </>
  );
}
