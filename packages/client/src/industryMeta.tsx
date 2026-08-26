import type { CompanyIndustryId } from "@dominion/shared";

// Purely presentational grouping for sidebar/detail avatars across Companies
// and Stock Market — no equivalent field on CompanyIndustryDef, so this
// stays a client-side lookup. The three extraction industries map onto
// their output resource's existing series color for consistency with the
// rest of the app; the three processing industries (which all output
// "goods") get distinct colors of their own since collapsing them onto
// --series-goods would make them indistinguishable in a sidebar.
export const INDUSTRY_META: Record<CompanyIndustryId, { color: string; letter: string }> = {
  farming: { color: "var(--series-food)", letter: "Fm" },
  logging: { color: "var(--series-wood)", letter: "Lg" },
  quarrying: { color: "var(--series-stone)", letter: "Qr" },
  bakery: { color: "var(--series-goods)", letter: "Bk" },
  sawmill: { color: "#b5763f", letter: "Sw" },
  stoneworks: { color: "#6b7280", letter: "St" },
  retail: { color: "#2f8f8a", letter: "Rt" },
  construction: { color: "#c9995f", letter: "Cn" },
};

export function CompanyAvatar({ industry, size = "sm" }: { industry: CompanyIndustryId; size?: "sm" | "lg" }) {
  const meta = INDUSTRY_META[industry];
  return (
    <div className={`cc-avatar${size === "lg" ? " cc-avatar--lg" : ""}`} style={{ background: meta.color }}>
      {meta.letter}
    </div>
  );
}
