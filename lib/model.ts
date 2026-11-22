// Token radar: snapshot in, ranked board out.
//
// The board ranks pre-token protocols — ones whose DefiLlama record carries
// no token (no CoinGecko id and no symbol) — by an implied launch value the
// model derives from the snapshot's own figures only: TVL, 7-day TVL change,
// days listed with no token, and chain count. No protocol name is ever
// special-cased; the same function scores every row, so a future snapshot
// with protocols that do not exist yet ranks them the same way.
//
//   base       = tvl_usd x baseMultiple
//   growth     = clamp(change_7d, floor, cap) per cent; losses weigh more
//   growthMult = 1 + (growth / 100) x growthWeight x (loss ? lossWeight : 1)
//   patience   = 0.7 + 0.4 x min(age_days, 1095) / 1095   (unknown age: 365)
//   breadth    = 1 + breadthPerChain x min(chains - 1, 4)
//   implied    = max(1, round(base x growthMult x patience x breadth))
//
// The intuition: a protocol that has run a long time at a large TVL with no
// token is the most "due" launch; fast growth pulls it up, shrinking TVL
// pushes it down harder than growth lifts it; running on several chains
// widens the surface a token would capture. Token-trading protocols are
// kept apart in a Live view at the market's own capitalisation, never
// mixed into the ranked board.
//
// Farm plans are phased (prepare -> fund -> act -> repeat -> hold ->
// verify -> log) and built from the protocol's own record — category,
// chains, TVL tier, age — so each plan names concrete amounts, gas costs
// and times instead of slogans.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One variant's knobs. A, B and C below differ only here. */
export interface VariantSpec {
  id: 'A' | 'B' | 'C';
  label: string;
  baseMultiple: number;
  growthWeight: number;
  growthFloor: number;
  growthCap: number;
  lossWeight: number;
  breadthPerChain: number;
  patienceFloor: number;
  patienceRange: number;
  patienceDays: number;
  unknownAgeDays: number;
}

export const VARIANTS: Record<'A' | 'B' | 'C', VariantSpec> = {
  A: {
    id: 'A', label: 'TVL-dominant',
    baseMultiple: 0.30, growthWeight: 0.15, growthFloor: -50, growthCap: 100,
    lossWeight: 1.0, breadthPerChain: 0,
    patienceFloor: 0.7, patienceRange: 0.4, patienceDays: 1095, unknownAgeDays: 365,
  },
  B: {
    id: 'B', label: 'growth-dominant',
    baseMultiple: 0.25, growthWeight: 1.2, growthFloor: -60, growthCap: 150,
    lossWeight: 1.0, breadthPerChain: 0,
    patienceFloor: 0.7, patienceRange: 0.4, patienceDays: 1095, unknownAgeDays: 365,
  },
  C: {
    id: 'C', label: 'composite',
    baseMultiple: 0.28, growthWeight: 0.8, growthFloor: -60, growthCap: 120,
    lossWeight: 1.5, breadthPerChain: 0.05,
    patienceFloor: 0.7, patienceRange: 0.4, patienceDays: 1095, unknownAgeDays: 365,
  },
};

/** The variant the entry ships with. Set after the A/B/C comparison. */
export const DEFAULT_VARIANT: 'A' | 'B' | 'C' = 'C';

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface ModelBreakdown {
  base: number;
  growthPct: number;
  growthMult: number;
  patienceMult: number;
  breadthMult: number;
  ageDays: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growthMult: number;
  patienceMult: number;
  breadthMult: number;
  /** TVL divided by the median TVL of its category on this board: the hidden-gem signal. */
  relStrength: number;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  variant: string;
  variant_label: string;
  baseMultiple: number;
  model_version: string;
  layout: 'standard' | 'dense';
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_universe: number;
  token_trading: number;
  top_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whole days from `listedAt` to `asOf`, at least 0; null when unknown or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the record carries no token at all: no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank it: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The implied value and every multiplier behind it, for one protocol. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  spec: VariantSpec,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? spec.unknownAgeDays;
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(spec.growthCap, Math.max(spec.growthFloor, rawGrowth));
  const weight = growthPct < 0 ? spec.growthWeight * spec.lossWeight : spec.growthWeight;
  const growthMult = Math.max(0.05, 1 + (growthPct / 100) * weight);
  const patienceMult = spec.patienceFloor
    + (Math.min(Math.max(ageForModel, 0), spec.patienceDays) / spec.patienceDays) * spec.patienceRange;
  const breadthMult = 1 + spec.breadthPerChain * Math.min(Math.max(p.chains.length - 1, 0), 4);
  const base = p.tvl_usd * spec.baseMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * patienceMult * breadthMult));
  return {
    implied,
    breakdown: {
      base: Math.round(base),
      growthPct,
      growthMult: round4(growthMult),
      patienceMult: round4(patienceMult),
      breadthMult: round4(breadthMult),
      ageDays: age,
    },
  };
}

/** Typical gas for one transaction on a chain, in dollars, from the chain's name. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 4.2;
  if (c === 'base') return 0.08;
  if (c.includes('arbitrum')) return 0.15;
  if (c.includes('optimism')) return 0.12;
  if (c.includes('solana')) return 0.02;
  if (c.includes('bsc') || c.includes('bnb')) return 0.25;
  if (c.includes('polygon')) return 0.05;
  if (c.includes('avalanche')) return 0.3;
  if (c.includes('zksync') || c.includes('linea') || c.includes('scroll')) return 0.2;
  return 0.8;
}

function money(n: number): string {
  return n >= 1 ? `$${n.toFixed(2).replace(/\.00$/, '')}` : `$${n.toFixed(2)}`;
}

/** Farm capital from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** Hold days from the protocol's age: younger needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The core on-chain action for the category, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralised') || c.includes('collateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and borrow $20 against it, then repay the borrow`;
  if (c.includes('dex') || c.includes('exchange'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open`;
  if (c.includes('yield') || c.includes('leveraged farm'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds in its app`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and place one small position in an open market`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the receipt tokens`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it`;
  if (c.includes('rwa') || c.includes('real world'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain asset through ${name} and keep the receipt token`;
  if (c.includes('liquid'))
    return `Deposit $${capital} of the liquid asset into ${name} on ${chain} and keep the receipt`;
  if (c.includes('farm'))
    return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** A second position type, so the farm is not a single deposit. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const half = Math.max(20, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp'))
    return `Lend a further $${half} on ${p.name} on ${chain} in a second asset so the wallet shows two position types`;
  if (c.includes('dex') || c.includes('exchange'))
    return `Swap $${half} through ${p.name} on ${chain} in a second pool so the wallet shows two pool types`;
  return `Open a second $${half} position on ${p.name} on ${chain} in a different pool or vault than the first`;
}

/**
 * A protocol's farm plan: seven phased steps, each an action with a cost
 * and a time, derived from the protocol's own record (category, chains,
 * TVL, age). No name is ever special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasPerTx(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeklyGas = money(gas);
  const steps: Array<{ text: string; cost: string; time: string }> = [
    {
      text: 'Prepare a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline',
      cost: '$0, the wallet itself is free',
      time: '5 minutes',
    },
    {
      text: `Fund that wallet with $${capital + 10} of USDC on ${chain} so gas and the position are covered`,
      cost: `${money(gas)} of gas plus the network fee to move the funds`,
      time: '10 minutes',
    },
    {
      text: `${coreAction(p, capital, chain)}.`,
      cost: `$${capital} of capital and about ${money(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondChain !== null
        ? `Repeat the core position on ${secondChain} with $${Math.max(20, Math.round(capital / 2))} so the farm spans two chains`
        : `${secondAction(p, capital, chain)}.`,
      cost: `about $${Math.max(20, Math.round(capital / 2))} of capital and about ${money(gasPerTx(secondChain ?? chain))} of gas`,
      time: '15 minutes',
    },
    {
      text: secondChain !== null
        ? `Do one qualifying action every week — a deposit, a borrow, a swap or a vote — and alternate it between ${chain} and ${secondChain} so the wallet stays active on both chains`
        : 'Do one qualifying action every week — a deposit, a borrow, a swap or a vote — so the wallet stays active',
      cost: `about ${weeklyGas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold every position for at least ${hold} days and open the protocol's own points or rewards page once a week to confirm the activity counts`,
      cost: `the $${capital} stays in the position, no extra fee to check`,
      time: `${hold} days of holding, 5 minutes a week to check`,
    },
    {
      text: 'Before any claim, open the claim link only from the protocol\'s own page, never from a message or search result, and write the wallet, dates and every transaction in a farm log',
      cost: '$0 to check, and never pay a fee to claim',
      time: '10 minutes',
    },
  ];
  return steps.map((s) => {
    let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    if (out.length < 20) out = `${out} Keep the position open and check the protocol's own page.`;
    return out;
  });
}

/** The board: every watchlist slug plus the strongest early pre-token rows below the floor. */
export function buildBoard(snapshot: Snapshot, spec: VariantSpec): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, spec);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.ageDays,
    token_status: 'pre-token' as const,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.ageDays),
  }));
}

/** Token-trading protocols, by market cap: the market's own value, never a model's. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot and one variant. */
export function buildRadar(snapshot: Snapshot, spec: VariantSpec): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, spec);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  // Category-relative strength: median TVL per category across this board.
  const byCat = new Map<string, number[]>();
  for (const r of board) {
    const key = r.category ?? '—';
    const arr = byCat.get(key);
    if (arr) arr.push(r.tvl_usd);
    else byCat.set(key, [r.tvl_usd]);
  }
  const median = new Map<string, number>();
  for (const [key, arr] of byCat) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median.set(key, sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    variant: spec.id,
    variant_label: spec.label,
    baseMultiple: spec.baseMultiple,
    model_version: MODEL_VERSION,
    layout: spec.id === 'C' ? 'dense' : 'standard',
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pre_token_universe: preToken,
    token_trading: snapshot.protocols.length - preToken,
    top_implied_usd: board.length > 0 ? board[0]!.implied_value_usd : 0,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      growthMult: r.model.growthMult,
      patienceMult: r.model.patienceMult,
      breadthMult: r.model.breadthMult,
      relStrength: Math.round((r.tvl_usd / (median.get(r.category ?? '—') ?? r.tvl_usd)) * 10) / 10,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
