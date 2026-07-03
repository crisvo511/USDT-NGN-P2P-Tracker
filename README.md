# Naira Rates — USDT/NGN Tracker

Real-time USDT/NGN buy & sell rates from **Bybit**, **Remitano**, **Quidax**, **Monica**, **Breet**, **NoOnes** and **Roqqu**, ready to deploy on Vercel.

> Binance & OKX are not included: both delisted NGN P2P in 2024 after Nigerian regulatory action.

## Data sources

| Platform | Source | Needs key? |
|---|---|---|
| Bybit | P2P API (median of top-5 ads) | No |
| Remitano | Public rates API | No |
| Quidax | Public spot ticker API | No |
| Monica, Breet, NoOnes, Roqqu | [Monierate](https://monierate.com) platform quotes | **Yes — free** |

### Monierate API key (required for Monica/Breet/NoOnes/Roqqu)

1. Create a free account at https://account.monierate.com and copy your API key
2. Add it to Vercel: `vercel env add MONIERATE_API_KEY` (or Project → Settings → Environment Variables)
3. Redeploy

Without the key, those 4 cards show "Unavailable"; Bybit/Remitano/Quidax still work.

Tip: open `/api/rates?debug=1` to see every platform code Monierate returns, in case a code needs remapping in `MONIERATE_PLATFORMS` (api/rates.js).

## How it works

```
Browser (index.html)  →  /api/rates (Vercel serverless)  →  4 exchange APIs
```

The serverless function is required because exchange APIs block direct browser calls (CORS). It fetches all four in parallel, returns JSON, and caches at Vercel's edge for 30s. The page auto-refreshes every 30s.

## Deploy (2 minutes)

**Option A — Vercel CLI**
```bash
npm i -g vercel
cd naira-rates
vercel --prod
```

**Option B — GitHub**
1. Push this folder to a GitHub repo
2. Go to vercel.com → Add New Project → import the repo → Deploy (no config needed)

## Test locally

```bash
npm i -g vercel
cd naira-rates
vercel dev
# open http://localhost:3000
```

## Notes & caveats

- **Buy** = price you pay per USDT; **Sell** = price you receive. Binance/Bybit/OKX use the median of the top-5 P2P ads; Remitano uses its published ask/bid.
- Exchange P2P endpoints are **unofficial** — they can change or rate-limit without notice. The dashboard degrades gracefully: a failing exchange shows "Unavailable" while others keep working.
- OKX sometimes blocks datacenter IPs. If OKX shows unavailable on Vercel, it usually resolves on redeploy (different IP), or you can remove it.
- Rates are indicative. Always confirm on the exchange before trading.

## Files

- `index.html` — dashboard UI
- `api/rates.js` — serverless aggregator (`GET /api/rates`)
