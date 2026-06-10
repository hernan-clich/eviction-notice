/**
 * Paper-trade friction model. Cash-flow accounting: opening a position costs
 * `size + friction`, closing returns `size × (exit/entry) − friction`. Gas is a
 * fixed cost per swap; fees + slippage are proportional. Real execution (#13)
 * swaps these estimates for on-chain numbers.
 */

export interface FrictionParams {
  gasPerSwapUsd: number;
  swapFeeRate: number;
  slippage: number;
}

/** Friction (USD) for a single swap of the given notional size. */
export function swapFrictionUsd(sizeUsd: number, params: FrictionParams): number {
  return params.gasPerSwapUsd + sizeUsd * (params.swapFeeRate + params.slippage);
}

/** Cash returned when closing: current asset value minus the closing swap's friction. */
export function closeProceedsUsd(
  sizeUsd: number,
  entryPx: number,
  exitPx: number,
  params: FrictionParams,
): number {
  return sizeUsd * (exitPx / entryPx) - swapFrictionUsd(sizeUsd, params);
}
