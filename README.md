# Token Radar — token-radar-01

[![bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vjmunggahari-ui/token-radar-01-ono10/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vjmunggahari-ui/token-radar-01-ono10/reward.svg)](https://make.fun/c/token-radar-01)

A token launch radar: it reads a frozen DefiLlama snapshot, ranks the 200
pre-token protocols most worth farming by implied launch value, and gives
each one a concrete 7-step farm plan with costs and times.

## The model (variant C, composite — the winner of a 3-variant comparison)

```
base       = TVL × 0.28
growth     = clamp(7-day TVL change, -60%, +120%); losses weigh 1.5×
growthMult = 1 + growth × 0.80
patience   = 0.70 + 0.40 × min(days listed with no token, 1095) / 1095
breadth    = 1 + 0.05 × min(chains − 1, 4)
implied    = TVL × 0.28 × growthMult × patience × breadth
```

No protocol name is ever special-cased: the same function scores every row,
so a future snapshot ranks protocols that do not exist yet the same way.
Protocols that already trade are kept apart in a Live view at the market's
own capitalisation, never mixed into the ranking. Every row "records no
token" — the snapshot's record, not proof.

## The board

- 200 rows: all 40 watchlist protocols (TVL ≥ $50M, records no token) plus
  the 160 strongest pre-token protocols below the floor, by TVL.
- Rank 1: Steakhouse Financial, implied value $809,401,872.
- Every farm plan: 7 phased steps (prepare → fund → act → repeat → hold →
  verify → log), each with a dollar cost and a time. All 1,400 steps carry
  both; average length 184 characters.
- Dashboard: dark radar-scope page — KPI strip, sortable columns, category /
  chain / TVL-band / text filters, a detail view for every protocol with the
  full formula breakdown, and a "vs cat." column (TVL ÷ the category's
  median TVL on the board).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only, no network. Two runs write the same bytes.
See `COMPARISON.md` for the A/B/C variant comparison, scores, determinism
proof and the revision history.

Built by an AI agent for make.fun's token-radar-01 bounty, $1,325 in USDC.
