# ₦ Naira Rates — USDT/NGN Real-time Rate Tracker

Dashboard theo dõi tỷ giá mua/bán USDT bằng Naira (NGN) theo thời gian thực từ **7 nền tảng**: Bybit, Remitano, Quidax, Monica, Breet, NoOnes, Roqqu. Chạy hoàn toàn trên Vercel (free tier), tự refresh mỗi 30 giây.

> **Vì sao không có Binance/OKX?** Cả hai đã gỡ toàn bộ NGN khỏi P2P năm 2024 sau đợt trấn áp của chính phủ Nigeria (Binance: 2/2024, OKX: 5/2024) và đến nay chưa mở lại. Thị trường đó không còn tồn tại để lấy giá.

---

## 1. Kiến trúc — cách tool hoạt động

```
Trình duyệt (index.html)
        │  fetch mỗi 30s
        ▼
/api/rates  (Vercel Serverless Function — api/rates.js)
        │  gọi song song, timeout 9s/nguồn
        ├── Bybit P2P API          (POST, public)
        ├── Remitano rates API     (GET, public)
        ├── Quidax ticker API      (GET, public)
        └── Monierate platforms.json (GET, cần API key)
              └── trả về giá của Monica, Breet, NoOnes, Roqqu trong 1 call
```

**Vì sao cần serverless function?** API của các sàn chặn request trực tiếp từ trình duyệt (CORS). Function trên Vercel đóng vai trò proxy: gọi tất cả nguồn song song phía server, gom kết quả thành 1 JSON duy nhất.

**Cache:** response được cache tại edge của Vercel 30 giây (`s-maxage=30, stale-while-revalidate=60`) — nhiều người mở trang cùng lúc cũng chỉ tốn 1 lượt gọi API mỗi 30s, tránh bị rate-limit.

**Chống lỗi dây chuyền:** mỗi nguồn được gọi độc lập (`Promise.allSettled`). Một sàn chết chỉ làm card đó hiện "Unavailable", các sàn khác vẫn chạy bình thường.

## 2. Nguồn dữ liệu & cách tính giá

| Nền tảng | Nguồn | Cách tính | Cần key? |
|---|---|---|---|
| **Bybit** | P2P API (`api2.bybit.com/fiat/otc/item/online`) | Median (trung vị) của top-5 quảng cáo mỗi chiều — lọc nhiễu từ ads giá ảo | Không |
| **Remitano** | Public API (`api.remitano.com/api/v1/rates/ads`) | Bid/ask chính thức Remitano công bố cho NGN | Không |
| **Quidax** | Public spot API (`app.quidax.io/api/v1/markets/tickers/usdtngn`) | Best ask (giá mua) / best bid (giá bán) từ orderbook | Không |
| **Monica** | [Monierate](https://monierate.com) aggregator | Quote Monierate thu thập từ app | **Có** (free) |
| **Breet** | Monierate | Như trên | **Có** |
| **NoOnes / Paxful** | Monierate | Như trên | **Có** |
| **Roqqu** | Monierate | Như trên | **Có** |

Monica/Breet/NoOnes/Roqqu **không có API rate công khai** (API của họ chỉ dành cho merchant/ví, phải có tài khoản), nên tool dùng Monierate — dịch vụ chuyên theo dõi tỷ giá của chính các app Nigeria này.

### Ý nghĩa Buy / Sell

- **Buy** = số Naira bạn **trả** để mua 1 USDT (luôn cao hơn)
- **Sell** = số Naira bạn **nhận** khi bán 1 USDT (luôn thấp hơn)
- **Spread** = chênh lệch Buy − Sell của sàn đó (spread càng nhỏ càng tốt)
- Badge **BEST BUY** (xanh) = sàn có giá mua **rẻ nhất**; **BEST SELL** (vàng) = sàn trả giá bán **cao nhất**
- Mũi tên ▲▼ = giá vừa tăng/giảm so với lần refresh trước

## 3. Cấu trúc file

```
naira-rates/
├── index.html      # Toàn bộ giao diện (HTML + CSS + JS, 1 file duy nhất)
├── api/
│   └── rates.js    # Serverless function gom giá từ 7 nguồn
└── README.md
```

## 4. Deploy lên Vercel

### Cách A — Vercel CLI (nhanh nhất)

```bash
npm i -g vercel
cd naira-rates        # QUAN TRỌNG: phải đứng TRONG thư mục này
vercel --prod
```

### Cách B — GitHub

1. Push thư mục lên GitHub repo
2. vercel.com → **Add New Project** → import repo → Deploy

> ⚠️ **Lỗi 404: NOT_FOUND sau khi deploy?** Vercel đang deploy sai thư mục gốc — `index.html` không nằm ở root. Nếu dùng CLI: chạy `vercel` từ **bên trong** `naira-rates/`. Nếu dùng GitHub và file nằm trong thư mục con: vào Project → **Settings → Build and Development Settings → Root Directory** → điền `naira-rates` → Redeploy.

### Cấu hình Monierate API key (bắt buộc cho Monica/Breet/NoOnes/Roqqu)

1. Tạo tài khoản miễn phí tại https://account.monierate.com, copy API key
2. Thêm vào Vercel:
   ```bash
   vercel env add MONIERATE_API_KEY production
   # dán key khi được hỏi
   vercel --prod
   ```
   (hoặc trên web: Project → Settings → Environment Variables)

Chưa có key: 4 card đó hiện "Unavailable (MONIERATE_API_KEY not set)", 3 sàn còn lại vẫn chạy.

## 5. Chạy thử local

```bash
cd naira-rates
vercel dev            # mở http://localhost:3000
```

Muốn test key local: tạo file `.env` chứa `MONIERATE_API_KEY=xxx` (đừng commit file này).

## 6. Kiểm tra & debug

| URL | Dùng để |
|---|---|
| `/api/rates` | Xem JSON thô tất cả các sàn |
| `/api/rates?debug=1` | Thêm field `_monierateCodes` — danh sách mã platform Monierate thực tế trả về |

**Nếu Monica/Breet/NoOnes/Roqqu báo "not listed on Monierate":** mở URL debug, xem `_monierateCodes`, rồi sửa mapping trong `api/rates.js`:

```js
const MONIERATE_PLATFORMS = {
  monica: ["monica"],          // thêm alias nếu Monierate dùng mã khác,
  breet: ["breet"],            // ví dụ: ["monica", "monica_cash"]
  noones: ["noones", "paxful"],
  roqqu: ["roqqu"],
};
```

Mapping so khớp theo kiểu "chứa chuỗi" (contains), không phân biệt hoa thường.

## 7. Tùy chỉnh

Tất cả nằm trong `index.html`:

- **Chu kỳ refresh:** sửa `const REFRESH_MS = 30000;` (đơn vị ms). Lưu ý nếu giảm dưới 30s thì cũng nên giảm `s-maxage` trong `api/rates.js` tương ứng.
- **Badge voucher Remitano** (nút xanh "🎁 Fee cashback 50–100%"): sửa text/link tại:
  ```js
  remitano: { ..., promo: { text: "🎁 Fee cashback 50–100% — Get voucher",
                            url: "https://remitano.com/vouchers" } },
  ```
  Đổi `url` thành referral link của bạn nếu muốn. Xóa dòng `promo` là badge biến mất. Có thể thêm `promo` cho bất kỳ sàn nào khác.
- **Dòng cảnh báo trượt giá:** sửa text trong `<div class="disclaimer">…</div>`
- **Thêm/bớt sàn:** thêm entry vào `EXCHANGES` (index.html) + viết fetcher tương ứng trong `api/rates.js`
- **Màu sắc:** đổi các biến CSS trong `:root`

## 8. Troubleshooting

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| 404 NOT_FOUND | Sai root directory — xem mục 4 |
| Card báo "Unavailable (timeout)" | Sàn phản hồi chậm >9s hoặc chặn IP datacenter của Vercel. Thường tự hết; redeploy để đổi IP |
| "Unavailable (HTTP 403/429)" | Bị rate-limit hoặc chặn. Tăng cache `s-maxage` trong `api/rates.js` |
| "MONIERATE_API_KEY not set" | Chưa thêm env var — xem mục 4 |
| "not listed on Monierate" | Sai mã platform — xem mục 6 |
| Buy thấp hơn Sell (vô lý) | Mapping chiều mua/bán của nguồn đó bị ngược — báo lại để sửa trong fetcher |

## 9. Giới hạn & lưu ý

- API của Bybit là endpoint **không chính thức** (unofficial) — có thể đổi format hoặc chặn bất kỳ lúc nào. Remitano/Quidax/Monierate là API công khai chính thức, ổn định hơn.
- Giá chỉ mang tính **tham khảo**. Giá khớp lệnh thực tế có thể khác do trượt giá (slippage), khối lượng lệnh, phương thức thanh toán và phí của từng nền tảng. Luôn kiểm tra trên sàn trước khi giao dịch.
- Monierate free tier có rate limit riêng — với cache 30s của tool này (~2.880 call/ngày tối đa, thực tế ít hơn nhiều) thường là đủ, nhưng hãy xem hạn mức trong dashboard Monierate của bạn.
- Không commit API key vào Git. Key chỉ nằm trong biến môi trường Vercel / file `.env` local.

---

*Built with a single HTML file + one Vercel serverless function. No framework, no build step.*
