// The token launch radar model: implied launch values derived from the snapshot's own figures.
//
// Method, in one paragraph: protocols in the snapshot that already record a token price the market's
// verdict on a dollar of TVL, per category (the median market-cap/TVL ratio, winsorised so one wild
// print cannot bend a category, and shrunk toward the snapshot-wide median where a category has few
// tokened peers to learn from). A protocol that records no token is then valued as its TVL times its
// category's ratio, adjusted by three signals the snapshot carries: its seven-day TVL momentum, how
// long it has run with no token recorded, and how many chains it operates on. Nothing is typed in by
// hand per protocol: change the snapshot and every number on the board moves.
//
// The board ranks protocols that record no token in the snapshot. "Records no token" is the snapshot's
// statement, not a claim about the world: DefiLlama's record can lag a launch, and the page says so.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface Scored {
  protocol: Protocol;
  watchlist: boolean;
  ratio: number; // the category mcap/TVL ratio applied (after shrinkage and clamping)
  ratioPeers: number; // tokened protocols in the category the ratio was learned from
  base: number; // tvl * ratio, before adjustments
  momentumFactor: number;
  ageFactor: number;
  breadthFactor: number;
  ageYears: number | null;
  impliedRaw: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  protocolCount: number;
  tokenedCount: number;
  tokenlessCount: number;
  watchlistCount: number;
  globalRatio: number;
  categories: { category: string; peers: number; ratio: number }[];
  rows: (BoardRow & {
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    watchlist: boolean;
    ratio: number;
    ratioPeers: number;
    base: number;
    momentumFactor: number;
    ageFactor: number;
    breadthFactor: number;
    ageYears: number | null;
  })[];
}

/** Read the sealed snapshot and check the shape the model relies on; throws on anything else. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols[] and watchlist[]');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: protocol ${String((p as Protocol).slug)} is missing slug, tvl_usd or chains`);
    }
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const RATIO_FLOOR = 0.005;
const RATIO_CAP = 10;
const RATIO_MIN_APPLIED = 0.01;
const RATIO_MAX_APPLIED = 3;
const SHRINK_PRIOR = 5; // pseudo-count of global-median observations blended into every category

/** Median market-cap/TVL per category, learned from the protocols that record a token. */
export function categoryRatios(snapshot: Snapshot): { global: number; byCategory: Map<string, { ratio: number; peers: number }> } {
  const samples = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(RATIO_CAP, Math.max(RATIO_FLOOR, p.mcap_usd / p.tvl_usd));
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = samples.get(key);
    if (list === undefined) samples.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = median(all);
  const byCategory = new Map<string, { ratio: number; peers: number }>();
  for (const [category, list] of samples) {
    const shrunk = (list.length * median(list) + SHRINK_PRIOR * global) / (list.length + SHRINK_PRIOR);
    byCategory.set(category, { ratio: Math.min(RATIO_MAX_APPLIED, Math.max(RATIO_MIN_APPLIED, shrunk)), peers: list.length });
  }
  return { global, byCategory };
}

const DAY_MS = 86_400_000;

/** Whole years between the day DefiLlama began tracking a protocol and the snapshot's day. */
export function ageInYears(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / (365.25 * DAY_MS);
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** Seven-day TVL momentum: a hot week lifts the mark, a bleeding one cuts it, both within bounds. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return clamp(1 + 0.02 * change7d, 0.75, 1.45);
}

/** A long tokenless track record is evidence of a considered launch; worth up to +45% at five years. */
export function ageFactor(ageYears: number | null): number {
  if (ageYears === null) return 1;
  return 1 + 0.09 * Math.min(ageYears, 5);
}

/** Operating on more chains is distribution a launch can price; a log scale, capped at +25%. */
export function breadthFactor(chainCount: number): number {
  return 1 + Math.min(0.05 * Math.log2(Math.max(1, chainCount)), 0.25);
}

/** Categories whose entries are products of a parent that already trades, per the watchlist's rule. */
const PARENT_PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(?:[Vv]\d+(?:\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;

/**
 * Would the watchlist's own rule keep this protocol if it cleared the floor? Mirrors the rule the
 * snapshot documents: not a wrapped, staked or bridged product of a tokened parent, no version tail,
 * no exchange's name up front. The radar applies it below the floor so its early finds are launches
 * still to come, not new wrappers of tokens that already trade.
 */
export function isLaunchCandidate(p: Protocol): boolean {
  if (p.category !== null && PARENT_PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** Value one tokenless protocol and keep every input to the number, so the page can show its working. */
export function scoreProtocol(
  p: Protocol,
  ratios: { global: number; byCategory: Map<string, { ratio: number; peers: number }> },
  asOf: string,
): Scored {
  const learned = ratios.byCategory.get(p.category ?? 'Uncategorised');
  const ratio = learned?.ratio ?? ratios.global;
  const base = p.tvl_usd * ratio;
  const ageYears = ageInYears(p.listed_at, asOf);
  const momentum = momentumFactor(p.change_7d);
  const age = ageFactor(ageYears);
  const breadth = breadthFactor(p.chains.length);
  return {
    protocol: p,
    watchlist: false,
    ratio,
    ratioPeers: learned?.peers ?? 0,
    base,
    momentumFactor: momentum,
    ageFactor: age,
    breadthFactor: breadth,
    ageYears,
    impliedRaw: base * momentum * age * breadth,
  };
}

// ---------------------------------------------------------------------------
// Farm plans. Each category group carries a pool of concrete steps; a row's plan is assembled from
// its group's pool (rotated by a hash of the slug, so two protocols in one category do not read
// identically) plus two steps computed from the protocol's own record — its seven-day momentum and
// its tokenless track record — and a closing watch step. Every step names the protocol, its chains
// or its figures: a plan is written for this protocol, not pasted onto it.
// ---------------------------------------------------------------------------

type Facts = {
  name: string;
  cat: string;
  chain1: string;
  chainN: string;
  chains: number;
  tvl: string;
  chg: string;
};

function fmtUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function fill(template: string, f: Facts): string {
  return template
    .replaceAll('{name}', f.name)
    .replaceAll('{cat}', f.cat)
    .replaceAll('{chain1}', f.chain1)
    .replaceAll('{chainN}', f.chainN)
    .replaceAll('{chains}', String(f.chains))
    .replaceAll('{tvl}', f.tvl)
    .replaceAll('{chg}', f.chg);
}

interface PoolStep {
  text: string;
  multi?: boolean; // speaks of a second chain; skipped for single-chain protocols
}

const POOLS: Record<string, PoolStep[]> = {
  lending: [
    { text: "Supply a blue-chip asset (ETH or a major stablecoin) into {name}'s main market on {chain1} and leave it supplied: lenders are the users a lending token most plausibly rewards, and an uninterrupted position of a few hundred dollars costs only the deposit gas (about $1-10) to open." },
    { text: 'Borrow a small amount against your supply — 20-30% of its value — and repay it after a few weeks: a completed borrow-and-repay cycle is the behaviour that separates lenders from deposit-and-forget wallets, and the interest on a small loan held a month is typically a few dollars.' },
    { text: 'Hold the position through at least one full month without withdrawing: duration is the cheapest signal to give and the one most often written into retroactive criteria, and it costs nothing but patience once the deposit is open.' },
    { text: "If {name} runs isolated or curated markets beyond its main one, place a small supply in one of those too: secondary markets are where active-user counts are thinnest, so the same dollars mark you in more of the protocol's user segments for one extra deposit's gas." },
    { text: "Take part in {name}'s governance — vote, or delegate to an active voter — and read its forum monthly: governance participation is public, costs gas only (or nothing off-chain), and is routinely named in launch posts as behaviour a token is meant to reward." },
    { text: "Open a second, smaller position on one of {name}'s other chains, {chainN}: multi-chain users are a minority of wallets in any lending market, and the bridge plus deposit costs roughly $5-15 all-in.", multi: true },
  ],
  dex: [
    { text: "Make {name} your default swap venue on {chain1} for a month of ordinary trades: swap flow from a wallet that also does other things on-chain reads as a real user, and routing trades you would make anyway costs nothing beyond the swap fees you already pay." },
    { text: 'Provide liquidity to a major pair on {name} — a stablecoin pair if you want low impermanent loss — and keep it in range for at least a few weeks: liquidity providers are the users every DEX launch has rewarded, and a few hundred dollars in a stable pair carries minimal price risk.' },
    { text: 'Claim and re-deposit any LP fees weekly rather than letting them sit: the repeated interactions build the transaction history that activity-based criteria count, for a few cents of gas each time on {chain1}.' },
    { text: "Try one advanced feature — a limit order, a concentrated range or an aggregator route — even at small size: feature breadth is a common multiplier in points programs, and a single $20 trade is enough to register in that segment of {name}'s users." },
    { text: "Bridge a small balance to {name} on a second chain, {chainN}, and repeat a swap there: per-chain user counts are tracked separately by most DEX dashboards, so one wallet active on two chains counts in two cohorts for about $5 of bridge and swap fees.", multi: true },
    { text: "If {name} opens a points or quests page, complete its onboarding tasks the week they appear: early cohorts are usually weighted most heavily, the tasks are typically the swaps and deposits above, and the whole set takes about 20 minutes." },
  ],
  yield: [
    { text: "Deposit into {name}'s flagship vault or curated market on {chain1} and stay deposited: vault depositors are the exact users a yield protocol's token is issued to, and entering costs one approval plus deposit gas (about $1-8)." },
    { text: 'Choose the vault whose strategy you can explain in one sentence, and size it so you can leave it for a full quarter: curator and allocator launches have historically weighted time-weighted balances, so three steady months beat a large one-week deposit.' },
    { text: "Add a second, smaller deposit in a different vault or on another chain ({chainN}): breadth across {name}'s markets marks you as a platform user rather than a single-vault mercenary, for the cost of one more deposit's gas.", multi: true },
    { text: 'Harvest or compound the yield monthly instead of daily: the cadence shows an engaged depositor rather than a bot, and monthly compounding on {chain1} keeps the gas cost to a few dollars a year.' },
    { text: "Read {name}'s risk reports or curator letters and keep short notes: if a governance forum or delegate program opens, informed depositors are who it recruits, and thirty minutes a month is the whole cost." },
    { text: "Set a monthly calendar review to confirm the vault's TVL and strategy have not changed direction: farming a vault you no longer understand is how airdrop hunters end up holding the loss when a strategy breaks, and the review takes ten minutes." },
  ],
  derivatives: [
    { text: "Open a small, fully-collateralised position on {name} — $50-100 of margin is enough — and close it after a few days: a completed trade cycle is the core activity a derivatives launch rewards, and at that size the fees are a few dollars." },
    { text: 'Trade once a week for a month rather than in one burst: venue dashboards count active weeks and distinct days, and steady small flow is both cheaper in fees and harder to mistake for wash activity.' },
    { text: "Provide margin or liquidity to {name}'s pool or vault side if it offers one, at small size: liquidity providers are scarcer than traders on young venues, so the same dollars usually carry more weight per user there." },
    { text: 'Use one feature beyond a plain market order — a limit order, a stop, a second market — exactly once: feature breadth is a standard multiplier in exchange points programs, and a single small order registers it.' },
    { text: 'Keep total exposure small and treat fees as the budget, not the bankroll: the goal is a clean activity record, and an account blown up and abandoned before any snapshot is the common failure mode of derivatives farming.' },
  ],
  staking: [
    { text: "Stake a small amount through {name} on {chain1} and hold the position for at least a month: stakers with duration are the canonical recipients of staking-protocol launches, and entering is a single transaction (about $1-5 of gas)." },
    { text: "Delegate or restake a second tranche through a different operator or vault inside {name}, if it offers the choice: operator diversity is publicly tracked and often named as a criterion, and splitting the position costs one extra transaction." },
    { text: 'Claim rewards on a monthly cadence and restake them: the claim history proves an attentive holder rather than a forgotten deposit, for a few cents of gas each month.' },
    { text: "Keep the position in one wallet and do not route it through fresh addresses between actions: continuity of the staking address is what any snapshot reads, and moving the position restarts the clock that matters for {name}." },
  ],
  rwa: [
    { text: "Complete {name}'s onboarding or KYC early if its market requires it: verified users are a small, countable cohort for an RWA launch, approval queues lengthen sharply once a token is rumoured, and the process takes about 15-30 minutes." },
    { text: "Make a minimum-size investment in one of {name}'s listed assets and hold it for a full reporting period: RWA positions are illiquid by design, so start with an amount you can genuinely leave in place for six months or more." },
    { text: "Hold through at least one distribution or interest payment: a wallet that has received yield from the underlying asset is provably a real investor in the record any launch would read, and it costs nothing beyond the holding itself." },
    { text: "Use {name}'s redemption or secondary flow once at small size, if it has one: users who have touched both sides of a marketplace are rarer than holders alone, and the round trip is what documents it." },
  ],
  stable: [
    { text: "Mint or buy a small position in {name}'s stablecoin or basis product on {chain1} and hold it in the wallet: holders of the asset itself are the first cohort any issuer launch reads, and entry is one swap or mint (about $1-5 in fees)." },
    { text: "Put the asset to work in one external venue {name} integrates with — a lending market or a liquidity pool — for at least a month: integrated usage is what turns a holder into distribution, and issuers track it through partner dashboards." },
    { text: 'Hold through a full funding or yield cycle, usually 30-90 days: basis products reward the wallets that stayed through a negative-funding stretch, which is exactly the period mercenary holders leave.' },
    { text: "Provide liquidity to the asset's main pool at small size: LPs keep the peg tradeable, a stable pair carries little impermanent loss, and the position registers you in a second user segment of {name}'s ecosystem." },
  ],
  infra: [
    { text: "Use {name}'s core product end-to-end once on {chain1}, at the smallest size it allows: a completed core action is the one record every launch in this category shares, and it usually costs under $5 in fees." },
    { text: 'Repeat the core action monthly for a quarter: infrastructure products count returning users above raw volume, and three months of small, regular activity is the cheapest durable signal you can give — a few dollars of fees in total.' },
    { text: "If {name} runs a testnet, faucet or early-access list, join it and keep the same wallet for mainnet use: teams routinely carry testnet cohorts into launch criteria, and testnet activity costs nothing but about twenty minutes." },
    { text: "Take part in {name}'s governance, forum or community calls where they exist: for a small infrastructure protocol the active community is tiny, so a recognisable, helpful presence is cheap to build now and impossible to buy later." },
  ],
  general: [
    { text: "Use {name}'s main product on {chain1} at small size this week — its core action, completed once, end to end: every launch reads its own product's usage first, and a single genuine interaction (usually under $5 in fees) is what puts a wallet in the user set at all." },
    { text: 'Return monthly for a quarter and repeat the core action: returning users are the cohort retroactive criteria are written for, and three months of small activity costs less than one week of chasing a rumoured snapshot.' },
    { text: "Hold whatever position or balance {name}'s product creates rather than exiting immediately: duration is recorded by every dashboard the team will consult when it designs a launch, and it costs nothing once the position is open." },
    { text: "Join {name}'s governance or community channel and vote or comment once: for a protocol of this size the active community is small, and early, identifiable participation is the one signal that cannot be bought later at any price." },
  ],
};

const GROUP_OF: Record<string, string> = {
  Lending: 'lending', CDP: 'lending', 'CDP Manager': 'lending', 'Uncollateralized Lending': 'lending',
  Dexs: 'dex', 'Liquidity Manager': 'dex',
  Yield: 'yield', 'Yield Aggregator': 'yield', Farm: 'yield', 'Leveraged Farming': 'yield',
  'Onchain Capital Allocator': 'yield', 'Risk Curators': 'yield',
  Derivatives: 'derivatives', Options: 'derivatives', 'Options Vault': 'derivatives',
  'Interest Rate Derivatives': 'derivatives', Synthetics: 'derivatives', 'Prediction Market': 'derivatives',
  Restaking: 'staking', 'Liquid Restaking': 'staking', 'Staking Pool': 'staking',
  'Anchor BTC': 'staking', 'Decentralized BTC': 'staking',
  RWA: 'rwa',
  'Basis Trading': 'stable', 'Algo-Stables': 'stable', 'Dual-Token Stablecoin': 'stable',
  'Stablecoin Issuer': 'stable', 'Stablecoin Wrapper': 'stable', 'Reserve Currency': 'stable',
  Chain: 'infra', Launchpad: 'infra', Indexes: 'infra', 'Token Locker': 'infra', Insurance: 'infra',
  Payments: 'infra', 'Crypto Card Issuer': 'infra', 'OTC Marketplace': 'infra', CeDeFi: 'infra',
  'Governance Incentives': 'infra', 'Collateral Markets': 'infra', Privacy: 'infra', 'Cross Chain Bridge': 'infra',
};

function hashSlug(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function momentumStep(p: Protocol, f: Facts): string {
  if (p.change_7d !== null && p.change_7d >= 5) {
    return fill("{name}'s TVL grew {chg}% in the seven days to the snapshot ({tvl} in total): momentum like this is often what precedes a points announcement, so start the core activity this week — after an announcement, the same snapshot has far more wallets competing for it.", f);
  }
  if (p.change_7d !== null && p.change_7d <= -5) {
    return fill("{name}'s TVL slipped {chg}% in the seven days to the snapshot: outflows thin the crowd, so a small position opened now and simply maintained costs less in fees and attention than chasing a recovery later, and it is already old when any launch window opens.", f);
  }
  if (p.change_7d !== null) {
    return fill("{name}'s TVL is roughly steady this week ({chg}%), so there is no momentum crowd to compete with: steady weekly activity is cheap to keep, easy to sustain for months, and exactly the pattern a retroactive launch criterion is written to find.", f);
  }
  return fill('The snapshot reports no seven-day change for {name}, so trade on its size and record instead: open the core position at a size you can hold for a quarter, and let duration — the signal every launch can measure — do the work.', f);
}

function trackStep(p: Protocol, scored: Scored, f: Facts): string {
  if (p.listed_at !== null && scored.ageYears !== null) {
    const since = new Date(Date.parse(`${p.listed_at}T00:00:00Z`)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const years = scored.ageYears >= 1 ? `${scored.ageYears.toFixed(1)} years` : `${Math.max(1, Math.round(scored.ageYears * 12))} months`;
    return fill(`Keep records of everything you do with {name} — transaction hashes and dates in a simple note: DefiLlama has tracked it since ${since} (${years} with no token recorded), and long tokenless runs tend to end in considered, retroactive launches whose criteria you will want to evidence.`, f);
  }
  return fill('The snapshot carries no listing date for {name}, so its history cannot be verified from the record alone: before committing real size, check the deployment age on a block explorer, and until then weight this row as younger and less proven than its {tvl} of TVL suggests.', f);
}

const WATCH_STEP = "Watch {name}'s official channels for a points program, a governance forum or a testnet opening: early programs usually launch quietly and the first cohort is the cheapest to join. A ten-minute check each week is the whole cost; if a points page appears, the steps above are the activity it will most likely count.";

/** Assemble one protocol's farm plan: group pool steps, rotated, plus its two record-driven steps. */
export function farmSteps(p: Protocol, scored: Scored): string[] {
  const f: Facts = {
    name: p.name,
    cat: p.category ?? 'DeFi',
    chain1: p.chains[0] ?? 'its main chain',
    chainN: p.chains[1] ?? p.chains[0] ?? 'a second chain',
    chains: p.chains.length,
    tvl: fmtUsd(p.tvl_usd),
    chg: p.change_7d === null ? '0' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}`,
  };
  const pool = POOLS[GROUP_OF[p.category ?? ''] ?? 'general'] ?? POOLS.general!;
  const usable = pool.filter((s) => p.chains.length >= 2 || s.multi !== true);
  const start = hashSlug(p.slug) % usable.length;
  const rotated: PoolStep[] = [];
  for (let i = 0; i < usable.length; i++) rotated.push(usable[(start + i) % usable.length]!);
  const picks = [usable[0]!, ...rotated.filter((s) => s !== usable[0])].slice(0, 4);
  const steps = [
    fill(picks[0]!.text, f),
    fill(picks[1]!.text, f),
    momentumStep(p, f),
    fill(picks[2]!.text, f),
    trackStep(p, scored, f),
    fill(picks[3]!.text, f),
    fill(WATCH_STEP, f),
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 597).trimEnd()}...` : s));
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

export const BOARD_SIZE = 260;

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const ratios = categoryRatios(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored: Scored[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null) continue; // a token already trades in the record: not this board's subject
    const onList = watchlist.has(p.slug);
    if (!onList && !isLaunchCandidate(p)) continue; // a wrapper or version of a tokened parent
    const s = scoreProtocol(p, ratios, snapshot.as_of);
    s.watchlist = onList;
    scored.push(s);
  }
  const byValue = (a: Scored, b: Scored): number =>
    b.impliedRaw - a.impliedRaw || b.protocol.tvl_usd - a.protocol.tvl_usd || (a.protocol.slug < b.protocol.slug ? -1 : 1);
  scored.sort(byValue);
  const listed = scored.filter((s) => s.watchlist);
  const early = scored.filter((s) => !s.watchlist).slice(0, Math.max(0, BOARD_SIZE - listed.length));
  const chosen = [...listed, ...early].sort(byValue);

  let previous = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = [];
  const rows: Radar['rows'] = [];
  chosen.forEach((s, i) => {
    const value = Math.max(1, Math.min(Math.round(s.impliedRaw), previous - 1));
    previous = value;
    const steps = farmSteps(s.protocol, s);
    board.push({ slug: s.protocol.slug, name: s.protocol.name, rank: i + 1, implied_value_usd: value, farm_steps: steps });
    rows.push({
      slug: s.protocol.slug,
      name: s.protocol.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: steps,
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      listed_at: s.protocol.listed_at,
      watchlist: s.watchlist,
      ratio: s.ratio,
      ratioPeers: s.ratioPeers,
      base: Math.round(s.base),
      momentumFactor: s.momentumFactor,
      ageFactor: s.ageFactor,
      breadthFactor: s.breadthFactor,
      ageYears: s.ageYears,
    });
  });

  const categories = [...ratios.byCategory.entries()]
    .map(([category, v]) => ({ category, peers: v.peers, ratio: v.ratio }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    protocolCount: snapshot.protocols.length,
    tokenedCount: snapshot.protocols.filter((p) => p.mcap_usd !== null).length,
    tokenlessCount: snapshot.protocols.filter((p) => p.mcap_usd === null).length,
    watchlistCount: snapshot.watchlist.length,
    globalRatio: ratios.global,
    categories,
    rows,
  };
  return { board, radar };
}

/** The gate's board rules, checked the same way here so a refused board never leaves the program. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `row ${row.rank}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim() === '') return `row ${row.rank}: empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `row ${row.rank}: implied_value_usd ${row.implied_value_usd} is not a positive whole number up to 1e14`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.rank}: ${row.farm_steps.length} farm steps, outside 3-12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.rank}: a farm step is ${len} characters once trimmed, outside 20-600`;
    }
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  const ranks = new Set(board.map((r) => r.rank));
  if (ranks.size !== board.length || Math.min(...ranks) !== 1 || Math.max(...ranks) !== board.length) {
    return 'ranks are not exactly 1 to N once each';
  }
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `implied value rises at rank ${byRank[i]!.rank}`;
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'every implied value is the same';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data, written beside the page as data.js (the page reads window.RADAR). */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
