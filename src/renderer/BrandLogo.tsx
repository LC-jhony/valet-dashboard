export function BrandLogo({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="17"
        fill="var(--brand-tile, #1b1b1e)"
        stroke="var(--brand-edge, color-mix(in srgb, var(--accent) 42%, transparent))"
        strokeWidth="1.4"
      />
      <path
        d="M17.5 19.5 32 45.5 46.5 19.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M26.5 51h11"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  )
}
