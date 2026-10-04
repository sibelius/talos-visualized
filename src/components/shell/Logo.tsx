/** Talos-ish mark: a control plane node linked to two workers. Also used by the OG renderer, so plain SVG only. */
export function Logo({ className = "size-8", size }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" className={size ? undefined : className} width={size} height={size} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#171b24" />
      <path d="M16 10 L9 22 M16 10 L23 22 M9 22 L23 22" stroke="#e7e9f0" strokeOpacity=".45" strokeWidth="1.3" fill="none" />
      <circle cx="16" cy="10" r="3.6" fill="#ff7a45" />
      <circle cx="9" cy="22" r="3.2" fill="#326ce5" />
      <circle cx="23" cy="22" r="3.2" fill="#22d3ee" />
    </svg>
  );
}
