import { RESOURCE_LABELS, type MarketResourceType } from "@dominion/shared";
import { useWorldContracts } from "../api/hooks.js";
import type { WorldContract } from "../api/client.js";

// The contract system only ever links a raw-extraction industry (output, no
// input) to the processing industry that consumes it, so the whole world's
// supply chain is structurally two columns, not an arbitrary graph — this
// mirrors that shape instead of reaching for a general force-layout library.
const PRODUCER_INDUSTRY_ORDER = ["farming", "logging", "quarrying"];
const PROCESSOR_INDUSTRY_ORDER = ["bakery", "sawmill", "stoneworks"];
const INDUSTRY_LABELS: Record<string, string> = {
  farming: "Farming",
  logging: "Logging",
  quarrying: "Quarrying",
  bakery: "Bakery",
  sawmill: "Sawmill",
  stoneworks: "Stoneworks",
};
const OUTPUT_LABELS: Record<MarketResourceType, string> = { ...RESOURCE_LABELS, goods: "Goods" };

const OWNER_LABELS: Record<WorldContract["sellerOwner"], string> = {
  you: "You",
  player: "Player",
  npc: "NPC",
};

const NODE_WIDTH = 176;
const NODE_HEIGHT = 52;
const ROW_GAP = 16;
const GROUP_GAP = 30;
const TOP_PADDING = 16;
const COLUMN_GAP = 220;

interface NodeInfo {
  id: string;
  name: string;
  industry: string;
  owner: WorldContract["sellerOwner"];
  y: number;
}

function layoutColumn(
  companies: Map<string, { name: string; industry: string; owner: WorldContract["sellerOwner"] }>,
  industryOrder: string[],
): NodeInfo[] {
  const byIndustry = new Map<string, NodeInfo[]>();
  for (const [id, c] of companies) {
    const list = byIndustry.get(c.industry) ?? [];
    list.push({ id, name: c.name, industry: c.industry, owner: c.owner, y: 0 });
    byIndustry.set(c.industry, list);
  }

  let y = TOP_PADDING;
  const nodes: NodeInfo[] = [];
  for (const industry of industryOrder) {
    const list = (byIndustry.get(industry) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) continue;
    y += 22; // section label
    for (const node of list) {
      node.y = y;
      nodes.push(node);
      y += NODE_HEIGHT + ROW_GAP;
    }
    y += GROUP_GAP - ROW_GAP;
  }
  return nodes;
}

export default function SupplyChain() {
  const { data, isLoading } = useWorldContracts();
  const contracts = data?.contracts ?? [];

  if (isLoading) {
    return (
      <div className="page page--full">
        <div className="loading">Loading the supply chain...</div>
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="page page--full">
        <div className="card">
          <h2 className="card__title">Supply Chain</h2>
          <div className="empty-state">
            No active supply contracts anywhere in the world yet — propose one from a company on
            the Companies page once you've founded a producer and a processor.
          </div>
        </div>
      </div>
    );
  }

  const sellers = new Map<string, { name: string; industry: string; owner: WorldContract["sellerOwner"] }>();
  const buyers = new Map<string, { name: string; industry: string; owner: WorldContract["sellerOwner"] }>();
  for (const c of contracts) {
    sellers.set(c.sellerCompanyId, { name: c.sellerCompanyName, industry: c.sellerIndustry, owner: c.sellerOwner });
    buyers.set(c.buyerCompanyId, { name: c.buyerCompanyName, industry: c.buyerIndustry, owner: c.buyerOwner });
  }

  const sellerNodes = layoutColumn(sellers, PRODUCER_INDUSTRY_ORDER);
  const buyerNodes = layoutColumn(buyers, PROCESSOR_INDUSTRY_ORDER);
  const sellerY = new Map(sellerNodes.map((n) => [n.id, n.y]));
  const buyerY = new Map(buyerNodes.map((n) => [n.id, n.y]));

  const height =
    Math.max(
      sellerNodes.length ? sellerNodes[sellerNodes.length - 1].y + NODE_HEIGHT : TOP_PADDING,
      buyerNodes.length ? buyerNodes[buyerNodes.length - 1].y + NODE_HEIGHT : TOP_PADDING,
    ) + TOP_PADDING;
  const width = NODE_WIDTH * 2 + COLUMN_GAP;
  const leftX = 0;
  const rightX = NODE_WIDTH + COLUMN_GAP;

  const uniqueCompanies = new Set([...sellers.keys(), ...buyers.keys()]).size;

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">Supply Chain</h2>
        <p className="stage-thesis" style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: 13 }}>
          Every active supply contract in the world, producers on the left feeding processors on
          the right — not just your own.
        </p>
        <div className="summary-bar">
          <div className="summary-stat">
            <div className="summary-stat__label">Active contracts</div>
            <div className="summary-stat__value">{contracts.length}</div>
          </div>
          <div className="summary-stat">
            <div className="summary-stat__label">Companies involved</div>
            <div className="summary-stat__value">{uniqueCompanies}</div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <svg width={width} height={height} style={{ display: "block", margin: "0 auto" }}>
            {contracts.map((c, i) => {
              const y1 = (sellerY.get(c.sellerCompanyId) ?? 0) + NODE_HEIGHT / 2;
              const y2 = (buyerY.get(c.buyerCompanyId) ?? 0) + NODE_HEIGHT / 2;
              const x1 = leftX + NODE_WIDTH;
              const x2 = rightX;
              const midX = (x1 + x2) / 2;
              const stroke = c.sellerOwner === "you" || c.buyerOwner === "you" ? "var(--accent)" : "var(--border)";

              // A pure midpoint label collides when two edges cross near the
              // center of the column gap — biasing toward the seller side
              // (where crossing edges are still spread out vertically by
              // their distinct rows) and alternating a small vertical nudge
              // keeps same-row-pair labels from stacking exactly on top of
              // each other too.
              const t = 0.32;
              const labelX = x1 + (x2 - x1) * t;
              const labelY = y1 + (y2 - y1) * t + (i % 2 === 0 ? -8 : 10);
              const label = `${OUTPUT_LABELS[c.resourceType]} · ${c.quantityPerHour}/hr @ ${c.pricePerUnit.toFixed(2)}g`;

              return (
                <g key={c.id}>
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.5}
                    opacity={0.8}
                  />
                  <rect
                    x={labelX - label.length * 2.9}
                    y={labelY - 10}
                    width={label.length * 5.8}
                    height={13}
                    fill="var(--surface-1)"
                    opacity={0.9}
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontFamily="var(--font-numeric)"
                    fill="var(--accent)"
                    fontWeight={700}
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {sellerNodes.map((n) => (
              <foreignObject key={n.id} x={leftX} y={n.y} width={NODE_WIDTH} height={NODE_HEIGHT}>
                <div className={`chain-node chain-graph-node${n.owner === "you" ? " chain-node--mine" : ""}`}>
                  <div className="chain-graph-node__name">{n.name}</div>
                  <div className="chain-graph-node__meta">
                    {INDUSTRY_LABELS[n.industry] ?? n.industry} · {OWNER_LABELS[n.owner]}
                  </div>
                </div>
              </foreignObject>
            ))}
            {buyerNodes.map((n) => (
              <foreignObject key={n.id} x={rightX} y={n.y} width={NODE_WIDTH} height={NODE_HEIGHT}>
                <div className={`chain-node chain-graph-node${n.owner === "you" ? " chain-node--mine" : ""}`}>
                  <div className="chain-graph-node__name">{n.name}</div>
                  <div className="chain-graph-node__meta">
                    {INDUSTRY_LABELS[n.industry] ?? n.industry} · {OWNER_LABELS[n.owner]}
                  </div>
                </div>
              </foreignObject>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
