# Solvency-Aware Sizing — skill manifest (#12 drawer)

Submission-ready descriptor for the CMC Skills Marketplace. The exact portal format is
confirmed at submission time; this captures everything a listing needs. The skill is **live**
once deployed (docs/deploy.md) — submitting is then a paste-and-go.

- **Name:** Solvency-Aware Sizing
- **unique_name:** `solvency-aware-sizing`
- **Summary:** Survival-optimal position sizing. Given a balance, burn rate, and a candidate
  trade's edge/volatility, returns how big to trade — or whether to skip — to maximise how long
  an autonomous agent stays solvent, not its expected return.
- **Endpoint:** `POST {SKILL_URL}/size`
- **Payment:** x402, **$0.01 USDC-equivalent per call**, settled on **BSC** (we own the
  requirements; not Base). Handshake: `402` with requirements → `X-PAYMENT` → `200` + decision +
  `X-PAYMENT-RESPONSE` receipt.
- **Health:** `GET {SKILL_URL}/healthz`

## Input (JSON body)

| Field | Type | Notes |
| --- | --- | --- |
| `balanceUsd` | number > 0 | current ledger balance |
| `peakBalanceUsd` | number > 0 | peak to date (drawdown is peak-to-trough) |
| `burnRatePerHourUsd` | number ≥ 0 | rent + expected data burn |
| `edge` | number | expected fractional return (e.g. `0.02`) |
| `volatility` | number > 0 | fractional downside over the hold |
| `gasPerSwapUsd` | number ≥ 0 | live gas per swap |
| `swapFeeRate` | number ≥ 0 = 0.0025 | fee per side |
| `slippage` | number ≥ 0 = 0.001 | round-trip slippage |
| `maxDrawdownFraction` | number (0,1] = 0.30 | DQ gate |
| `maxPositionFraction` | number (0,1] = 0.75 | never all-in |
| `minPositionUsd` | number > 0 = 5 | smallest viable position |
| `edgeMargin` | number ≥ 0 = 0.005 | required edge over friction |
| `mustTrade` | boolean = false | force least-harmful trade (≥1/day rule) |

## Output

```json
{ "decision": "trade" | "skip", "sizeUsd": 0, "roundTripFrictionFraction": 0, "reason": "…" }
```

Source of truth for the schema: `sizingInputSchema` / `sizingDecisionSchema` in `apps/skill/src/sizing.ts`.
