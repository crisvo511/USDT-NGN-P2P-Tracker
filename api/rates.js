// Vercel serverless function: aggregates USDT/NGN P2P rates
// from Binance, Bybit, OKX and Remitano.
// GET /api/rates  ->  { updatedAt, rates: { binance: {buy, sell}, ... } }

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

// ---------- Binance P2P ----------
// tradeType BUY  = ads where YOU buy USDT (sellers' asks)
// tradeType SELL = ads where YOU sell USDT (buyers' bids)
async function binanceSide(tradeType) {
  const data = await fetchJson(
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset: "USDT",
        fiat: "NGN",
        tradeType,
        page: 1,
        rows: 5,
        payTypes: [],
        publisherType: null,
      }),
    }
  );
  const ads = (data.data || []).map((a) => parseFloat(a.adv.price)).filter(Boolean);
  if (!ads.length) throw new Error("no ads");
  // median of top-5 ads to smooth out outlier ads
  return median(ads);
}

async function binance() {
  const [buy, sell] = await Promise.all([binanceSide("BUY"), binanceSide("SELL")]);
  return { buy, sell };
}

// ---------- Bybit P2P ----------
// side "1" = ads selling USDT to you (your BUY price)
// side "0" = ads buying USDT from you (your SELL price)
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
  const [buy, sell] = await Promise.all([bybitSide("1"), bybitSide("0")]);
  return { buy, sell };
}

// ---------- OKX P2P ----------
// side=sell -> merchants selling USDT (your BUY price)
// side=buy  -> merchants buying USDT (your SELL price)
async function okxSide(side) {
  const url =
    "https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=NGN&baseCurrency=USDT" +
    `&side=${side}&paymentMethod=all&userType=all&showTrade=false&showFollow=false` +
    "&showAlreadyTraded=false&isAbleFilter=false&t=" +
    Date.now();
  const data = await fetchJson(url, {
    headers: {
      Referer: "https://www.okx.com/p2p-markets/ngn/buy-usdt",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const list = data?.data?.[side] || [];
  const prices = list.slice(0, 5).map((o) => parseFloat(o.price)).filter(Boolean);
  if (!prices.length) throw new Error("no ads");
  return median(prices);
}

async function okx() {
  const [buy, sell] = await Promise.all([okxSide("sell"), okxSide("buy")]);
  return { buy, sell };
}

// ---------- Remitano ----------
// usdt_ask = price you BUY at, usdt_bid = price you SELL at
async function remitano() {
  const data = await fetchJson(
    "https://api.remitano.com/api/v1/rates/ads?coin_currency=usdt&fiat_currency=ngn"
  );
  const ng = data?.ng;
  if (!ng) throw new Error("no NGN data");
  const buy = parseFloat(ng.usdt_ask);
  const sell = parseFloat(ng.usdt_bid);
  if (!buy && !sell) throw new Error("no rates");
  return { buy: buy || null, sell: sell || null };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default async function handler(req, res) {
  const sources = { binance, bybit, okx, remitano };
  const entries = await Promise.allSettled(
    Object.entries(sources).map(async ([name, fn]) => [name, await fn()])
  );

  const rates = {};
  for (let i = 0; i < entries.length; i++) {
    const name = Object.keys(sources)[i];
    const r = entries[i];
    rates[name] =
      r.status === "fulfilled"
        ? { ...r.value[1], ok: true }
        : { buy: null, sell: null, ok: false, error: r.reason?.message || "failed" };
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  res.status(200).json({ updatedAt: new Date().toISOString(), rates });
}
