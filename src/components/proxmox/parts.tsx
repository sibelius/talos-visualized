"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui";

/** A physical Proxmox host ("zone") box. */
export function HostBox({
  name,
  sub,
  down,
  active,
  children,
  className,
  onClick,
}: {
  name: string;
  sub?: ReactNode;
  down?: boolean;
  active?: boolean;
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "relative min-w-0 rounded-lg border p-2 transition-all duration-300",
        down ? "border-bad/60 bg-bad/5 opacity-60" : active ? "border-accent/70 bg-accent/5" : "border-line bg-panel-2/50",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink">
          <ServerIcon className={clsx("size-3.5", down ? "text-bad" : "text-accent")} />
          {name}
        </span>
        {down ? <span className="font-mono text-[10px] text-bad">down</span> : sub}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function VmChip({
  name,
  vmid,
  tone = "default",
  right,
  children,
  className,
}: {
  name: string;
  vmid?: number | string;
  tone?: "default" | "active" | "ok" | "bad" | "ghost" | "warn";
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-md border px-2 py-1 transition-all duration-300",
        tone === "default" && "border-line bg-bg/60",
        tone === "active" && "border-accent bg-accent/10",
        tone === "ok" && "border-ok/60 bg-ok/10",
        tone === "bad" && "border-bad/60 bg-bad/10",
        tone === "warn" && "border-warn/60 bg-warn/10",
        tone === "ghost" && "border-dashed border-line bg-transparent opacity-40",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
        <span className="truncate text-ink">
          {vmid !== undefined && <span className="text-faint">{vmid} </span>}
          {name}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function ServerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
      <rect x="2" y="9" width="12" height="4.5" rx="1" />
      <circle cx="4.5" cy="4.75" r=".6" fill="currentColor" />
      <circle cx="4.5" cy="11.25" r=".6" fill="currentColor" />
    </svg>
  );
}

export function DiskIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  );
}

export type YLine = { t: string; tone?: "new" | "del" | "dim" | "warn" };

/** Line-by-line YAML/text view with highlighted (new) and removed lines. */
export function LiveText({ lines, title, className }: { lines: YLine[]; title?: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0 overflow-hidden rounded-lg border border-line bg-bg", className)}>
      {title && <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-faint">{title}</div>}
      <pre className="overflow-x-auto p-2 font-mono text-[11.5px] leading-[1.6]">
        {lines.map((l, i) => (
          <div
            key={i + l.t}
            className={clsx(
              "-mx-2 px-2 whitespace-pre transition-colors duration-500",
              l.tone === "new" && "animate-rise bg-ok/10 text-ok",
              l.tone === "del" && "bg-bad/10 text-bad line-through decoration-bad/60",
              l.tone === "warn" && "bg-warn/10 text-warn",
              l.tone === "dim" && "text-faint",
              !l.tone && "text-muted",
            )}
          >
            {l.t || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Numbered step list used by the step-through demos. */
export function StepList({
  steps,
  current,
  onPick,
}: {
  steps: { title: ReactNode; who?: string }[];
  current: number;
  onPick?: (i: number) => void;
}) {
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onPick?.(i)}
            className={clsx(
              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition",
              i === current ? "bg-accent/10 text-ink" : i < current ? "text-muted hover:bg-panel-2" : "text-faint hover:bg-panel-2",
            )}
          >
            <span
              className={clsx(
                "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border font-mono text-[9px]",
                i < current ? "border-ok bg-ok/20 text-ok" : i === current ? "border-accent text-accent" : "border-line",
              )}
            >
              {i < current ? "✓" : i + 1}
            </span>
            <span className="min-w-0">
              {s.who && <span className="mr-1.5 font-mono text-[10px] text-accent-2">{s.who}</span>}
              {s.title}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Simple event log. */
export function EventLog({ items, className }: { items: { who: string; msg: ReactNode; tone?: "ok" | "bad" | "warn" | "info" }[]; className?: string }) {
  return (
    <div className={clsx("max-h-56 overflow-y-auto rounded-lg border border-line bg-bg p-2 font-mono text-[11px] leading-relaxed", className)} aria-live="polite">
      {items.length === 0 && <div className="text-faint">waiting…</div>}
      {items.map((e, i) => (
        <div key={i} className="animate-rise">
          <span className="text-accent-2">{e.who}</span>{" "}
          <span
            className={clsx(
              e.tone === "ok" && "text-ok",
              e.tone === "bad" && "text-bad",
              e.tone === "warn" && "text-warn",
              e.tone === "info" && "text-info",
              !e.tone && "text-muted",
            )}
          >
            {e.msg}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Runs a list of callbacks one after another with a fixed gap. */
export function useTimeline(gapMs = 1000) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const cancel = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRunning(false);
  };
  const run = (fns: (() => void)[]) => {
    cancel();
    setRunning(true);
    fns.forEach((fn, i) => timers.current.push(setTimeout(fn, i * gapMs)));
    timers.current.push(setTimeout(() => setRunning(false), Math.max(0, fns.length - 1) * gapMs + 10));
  };
  return { run, cancel, running };
}

/** Step state with optional auto-play. `last` is the final step index. */
export function useStepper(last: number, intervalMs = 1700) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, last)), intervalMs);
    return () => clearTimeout(t);
  }, [playing, step, last, intervalMs]);
  return {
    step,
    playing,
    setStep: (s: number) => {
      setPlaying(false);
      setStep(Math.max(0, Math.min(last, s)));
    },
    next: () => setStep((s) => Math.min(s + 1, last)),
    prev: () => setStep((s) => Math.max(s - 1, 0)),
    play: () => {
      if (step >= last) setStep(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    reset: () => {
      setPlaying(false);
      setStep(0);
    },
  };
}

export function StepControls({ s, last }: { s: ReturnType<typeof useStepper>; last: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.playing ? (
        <Button onClick={s.pause}>Pause</Button>
      ) : (
        <Button variant="primary" onClick={s.play}>
          {s.step >= last ? "Replay" : "Play"}
        </Button>
      )}
      <Button variant="ghost" onClick={s.prev} disabled={s.step === 0}>
        ← Back
      </Button>
      <Button onClick={() => s.setStep(s.step + 1)} disabled={s.step >= last}>
        Step →
      </Button>
      <Button variant="ghost" onClick={s.reset}>
        Reset
      </Button>
      <span className="font-mono text-[11px] text-faint">
        {s.step}/{last}
      </span>
    </div>
  );
}
