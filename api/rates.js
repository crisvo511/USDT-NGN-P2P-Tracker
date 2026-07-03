// Vercel serverless function: aggregates USDT/NGN rates from
// Bybit P2P, Remitano, Quidax (direct public APIs) and
// Monica / Breet / NoOnes / Roqqu (via Monierate platform quotes).
//
// GET /api/rates -> { updatedAt, rates: { bybit: {buy, sell, ok}, ... } }
//
// Env var required for Monica/Breet/NoOnes/Roqqu:
//   MONIERATE_API_KEY  (free key from https://account.monierate.com)

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 9000;

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

async function fetchJson(url, options = {}) {
  const res = await withTimeout(
    fetch(url, {
      ...options,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(options.headers || {}),
      },
    })
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- Bybit P2P ----------
// side "0" = merchants selling USDT (your BUY price)
// side "1" = merchants buying USDT (your SELL price)
async function bybitSide(side) {
  const data = await fetchJson("https://api2.bybit.com/fiat/otc/item/online", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: "USDT",
      currencyId: "NGN",
      side,
      payment: [],
      page: "1",
      size: "5",
      amount: "",
      authMaker: false,
      canTrade: false,
    }),
  });
  const items = data?.result?.items || [];
  const prices = items.map((i) => parseFloat(i.price)).filter(Boolean);
  if (!prices.length) throw new Error("no ads");
  return median(prices);
}

async function bybit() {
  const [buy, sell] = await Promise.all([bybitSide("0"), bybitSide("1")]);
  return { buy, sell };
}

// ---------- Remitano ----------
// Remitano's "bid" = the (higher) price you pay to BUY USDT,
// "ask" = the (lower) price you receive when you SELL — verified against live NGN data.
async function remitano() {
  const data = await fetchJson(
    "https://api.remitano.com/api/v1/rates/ads?coin_currency=usdt&fiat_currency=ngn"
  );
  const ng = data?.ng;
  if (!ng) throw new Error("no NGN data");
  const buy = parseFloat(ng.usdt_bid);
  const sell = parseFloat(ng.usdt_ask);
  if (!buy && !sell) throw new Error("no rates");
  return { buy: buy || null, sell: sell || null };
}

// ---------- Quidax (spot orderbook, public API) ----------
// ticker.sell = lowest ask (your BUY price), ticker.buy = highest bid (your SELL price)
async function quidax() {
  const data = await fetchJson(
    "https://app.quidax.io/api/v1/markets/tickers/usdtngn"
  );
  const t = data?.data?.ticker;
  if (!t) throw new Error("no ticker");
  return { buy: parseFloat(t.sell) || null, sell: parseFloat(t.buy) || null };
}

// ---------- Monierate (aggregator: Monica, Breet, NoOnes, Roqqu, ...) ----------
// One call returns buy/sell quotes from every platform ("changer") on the ticker.
// Docs: https://docs.monierate.com/api-reference/rates/platforms
const MONIERATE_PLATFORMS = {
  monica: ["monica"],
  breet: ["breet"],
  noones: ["noones", "paxful"],
  roqqu: ["roqqu"],
};

async function monieratePlatforms() {
  const key = process.env.MONIERATE_API_KEY;
  if (!key) throw new Error("MONIERATE_API_KEY not set");

  let data;
  try {
    data = await fetchJson(
      "https://api.monierate.com/core/rates/platforms.json?ticker=usdtngn",
      { headers: { api_key: key } }
    );
  } catch {
    // fallback: some plans/pairs expose USD instead of USDT
    data = await fetchJson(
      "https://api.monierate.com/core/rates/platforms.json?ticker=usdngn",
      { headers: { api_key: key } }
    );
  }

  const platforms = data?.data?.platforms || [];
  const out = { _codes: platforms.map((p) => p.code) };

  for (const [name, aliases] of Object.entries(MONIERATE_PLATFORMS)) {
    const hit = platforms.find((p) =>
      aliases.some((a) => (p.code || "").toLowerCase().includes(a))
    );
    out[name] = hit
      ? {
          buy: parseFloat(hit.buy) || null,
          sell: parseFloat(hit.sell) || null,
          ok: true,
          source: "monierate:" + hit.code,
          lastUpdated: hit.last_updated || null,
        }
      : { buy: null, sell: null, ok: false, error: "not listed on Monierate" };
  }
  return out;
}

export default async function handler(req, res) {
  const direct = { bybit, remitano, quidax };

  const [directResults, monierateResult] = await Promise.all([
    Promise.allSettled(
      Object.entries(direct).map(async ([name, fn]) => [name, await fn()])
    ),
    monieratePlatforms().then(
      (v) => ({ ok: true, value: v }),
      (e) => ({ ok: false, error: e.message })
    ),
  ]);

  const rates = {};
  const directNames = Object.keys(direct);
  directResults.forEach((r, i) => {
    rates[directNames[i]] =
      r.status === "fulfilled"
        ? { ...r.value[1], ok: true }
        : { buy: null, sell: null, ok: false, error: r.reason?.message || "failed" };
  });

  if (monierateResult.ok) {
    const m = monierateResult.value;
    for (const name of Object.keys(MONIERATE_PLATFORMS)) rates[name] = m[name];
    if (req.query?.debug) rates._monierateCodes = m._codes;
  } else {
    for (const name of Object.keys(MONIERATE_PLATFORMS)) {
      rates[name] = { buy: null, sell: null, ok: false, error: monierateResult.error };
    }
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.status(200).json({ updatedAt: new Date().toISOString(), rates });
}
