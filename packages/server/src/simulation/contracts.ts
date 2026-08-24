export interface ContractLike {
  quantityPerHour: number;
  pricePerUnit: number;
}

export interface ContractSettlement {
  transferred: number; // resource units moved seller -> buyer
  grossCost: number; // gold moved buyer -> seller before tax
}

/**
 * Same scarcity-capping idiom as tickCompany's production fulfillment: a
 * contract asks for quantityPerHour * elapsedHours, but actually moves the
 * minimum of what's desired, what the seller has in stock, and what the
 * buyer can afford. A contract that can't be fully honored one tick just
 * transfers less that tick — no penalty, no default, it isn't a loan.
 */
export function settleContract(
  contract: ContractLike,
  elapsedHours: number,
  sellerGoodsStock: number,
  buyerCash: number,
): ContractSettlement {
  const desired = contract.quantityPerHour * elapsedHours;
  const affordableByCash = contract.pricePerUnit > 0 ? buyerCash / contract.pricePerUnit : desired;
  const transferred = Math.max(0, Math.min(desired, sellerGoodsStock, affordableByCash));
  return { transferred, grossCost: transferred * contract.pricePerUnit };
}
