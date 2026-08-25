// Small stroke-style icons for the page-tab rail, icon rows, and build/research
// palettes. Deliberately minimal (single stroke, no fills) so they read at
// 16-34px and pick up `currentColor` from whatever wrapper sets it, rather
// than carrying their own hardcoded color.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function HouseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9h14v-9" />
    </svg>
  );
}

export function WheatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2c2 3 2 5 0 8-2-3-2-5 0-8z" />
      <path d="M12 22v-9" />
      <path d="M9 14l3-2 3 2" />
      <path d="M9 18l3-2 3 2" />
    </svg>
  );
}

export function TreeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2l6 11H6z" />
      <path d="M12 22V13" />
    </svg>
  );
}

export function MountainIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 19l6-11 4 6 2-3 6 8z" />
    </svg>
  );
}

export function CoinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5c0-1.2 1-2 2.5-2s2.5.8 2.5 2c0 2.5-5 1.5-5 4 0 1.2 1 2 2.5 2s2.5-.8 2.5-2" />
    </svg>
  );
}

export function StorefrontIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h16M4 8l2-4h12l2 4M4 8v12h16V8" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

export function HammerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.7 6.3l3 3L7 20H4v-3z" />
      <path d="M13 8l3-3 3 3-3 3" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 19V5a2 2 0 012-2h11v18H6a2 2 0 01-2-2z" />
      <path d="M9 7h6M9 11h6" />
    </svg>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

export function PlusCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8 12h8" />
    </svg>
  );
}

export function ScrollIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18 14 14 0 010-18z" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    </svg>
  );
}
