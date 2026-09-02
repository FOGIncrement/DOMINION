import type { CompanyIndustryId } from "@dominion/shared";

// Purely presentational grouping for sidebar/detail avatars across Companies
// and Stock Market — no equivalent field on CompanyIndustryDef, so this
// stays a client-side lookup.
export const INDUSTRY_META: Record<CompanyIndustryId, { color: string; letter: string }> = {
  powerPlant: { color: "#e0b93f", letter: "Pw" },
  fertilizerPlant: { color: "#8a6d3b", letter: "Fz" },
  farm: { color: "#7fae4a", letter: "Fm" },
  wheatFarm: { color: "var(--series-food)", letter: "Wh" },
  packagingPlant: { color: "#a68a64", letter: "Pk" },
  flourMill: { color: "#d9c38a", letter: "Fl" },
  bakery: { color: "#c9995f", letter: "Bk" },
  retail: { color: "#2f8f8a", letter: "Rt" },
};

export function CompanyAvatar({ industry, size = "sm" }: { industry: CompanyIndustryId; size?: "sm" | "lg" }) {
  const meta = INDUSTRY_META[industry];
  return (
    <div className={`cc-avatar${size === "lg" ? " cc-avatar--lg" : ""}`} style={{ background: meta.color }}>
      {meta.letter}
    </div>
  );
}
