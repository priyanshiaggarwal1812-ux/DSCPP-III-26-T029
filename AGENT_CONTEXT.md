# TradeX Frontend (HTML + CSS + JavaScript only) - Handoff and Agent Context

## 1. What this project is
TradeX is a real-time stock order book and matching system (college project, team "Order Book Operators", DSCPP-III-26-T029).
The BACKEND is a C++ engine (std::map + std::list order book, unordered_map order index, price-time matching, 50,000 bot orders) exposed by a small HTTP server (cpp-httplib + nlohmann/json). Other team members build it.
This document is the FRONTEND only: a plain website (8 pages, live canvas graphs, trading screen) written in pure HTML, CSS and JavaScript. It talks to the backend ONLY through the API contract in section 5.

## 2. Instructions for an AI agent continuing this project
- HTML + CSS + vanilla JavaScript ONLY. No React, no TypeScript, no npm, no build step, no CDN libraries, no frameworks. Charts are drawn with the HTML5 canvas in js/charts.js.
- Every page is its own .html file. Scripts are plain <script> tags (not ES modules, so it also works by double-clicking the file) and share one global namespace: window.TX. Keep the script order: config, utils, mock, api, store, charts, layout, then pages/<page>.js.
- Mock mode: js/config.js has TX.USE_MOCK = true. The site then runs with NO backend (fake REST in js/mock.js and a fake live feed). Keep mock mode working. Set USE_MOCK = false to use the real C++ server.
- All backend calls go through TX.api() in js/api.js. Never call fetch directly from page scripts.
- Live data flow: EventSource /stream -> buffer -> flushed every 250 ms -> TX.market.apply() -> TX.market.emit() -> page draw() functions. Charts must not animate. Keep at most 300 price points and 50 trades.
- Do not change the API contract (section 5) without telling the user, because the C++ backend must match it.
- Always escape backend text before putting it in innerHTML: TX.esc(). Never re-render a container that holds clickable buttons every 250 ms (clicks get lost); render once, or only update text nodes or only when data changed.
- Theme: dark, CSS variables in css/style.css. Buy/up is always green, sell/down always red. Prices and quantities use the mono font. Responsive: layout collapses under 900 px with a Menu button.
- Timestamps are unix SECONDS (not milliseconds).
- Not opened in a browser by the author of this document. First step for any agent: open index.html (or run a static server), check the browser console, and fix any errors before adding features.

## 3. How to run
```
Option A: double-click index.html (landing page; mock mode works from file://)
Option B: python -m http.server 5500   then open http://localhost:5500/
Option C: VS Code "Live Server" extension on index.html
```
Mock login: any username and password works. Real backend: set TX.USE_MOCK=false and TX.API_BASE='http://localhost:8080' in js/config.js. The C++ server must then send CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Headers: Authorization, Content-Type, Access-Control-Allow-Methods) and answer OPTIONS. Alternative: let the C++ server serve this folder with set_mount_point and set TX.API_BASE = '' (same origin, no CORS needed).

## 4. Folder structure
```
tradex-frontend/
  index.html(Landing)  login.html  dashboard.html  trade.html  orders.html  stocks.html(My Stocks)
  portfolio.html  history.html  depth.html  profile.html  performance.html  receipts.html
  AGENT_CONTEXT.md
  css/
    style.css            all styling and the dark theme variables
  js/
    config.js            TX.USE_MOCK, TX.API_BASE
    utils.js             TX.$, TX.esc, TX.fmt, TX.SYMBOLS, TX.validate, TX.toast, TX.table
    mock.js              fake REST backend + fake live feed (TX.mock, TX.startMockFeed)
    api.js               TX.api() and one function per endpoint
    store.js             TX.auth (session) and TX.market (live state + stream)
    charts.js            canvas charts: line, bars, depth, donut
    layout.js            navbar, login guard, symbol selector, connection badge
    pages/
      login.js dashboard.js trade.js orders.js portfolio.js history.js depth.js profile.js
```
Pages and menu: Login/Register (public), Dashboard, Trade (main screen), Orders, Portfolio, History, Market Depth, Profile. All except Login redirect to login.html when there is no session token.

## 5. API contract (backend must match)
JSON everywhere. Auth header on every call except login/register: Authorization: Bearer TOKEN.
Errors: proper HTTP status and body {"error":"human readable message"}. A 401 logs the user out.
```
POST   /register   {username,password}              -> {token,username,account_id}
POST   /login      {username,password}              -> {token,username,account_id}
POST   /password   {old_password,new_password}      -> {ok:true}
GET    /stocks                                      -> [{symbol,name,owner,user:bool,price}]  (company stocks have user:false, owner:null)
POST   /stocks     {symbol,name,supply,price}       -> {symbol,name,owner,user:true,price}   (a user lists their own stock)
GET    /book/:symbol                                -> {symbol,bids:[[price,qty]],asks:[[price,qty]],last}
POST   /order      {symbol,side:"BUY"|"SELL",orderType:"LIMIT"|"MARKET",price?,quantity} -> {order_id,status:"OPEN"|"PARTIALLY_FILLED"|"FILLED",filled}
                   (type is optional, default LIMIT. MARKET has NO price; unfilled rest is cancelled. Rejections -> HTTP 400 {"error":...})
DELETE /order/:id                                   -> {ok:true}
GET    /orders                                      -> [{id,symbol,side,price,qty,remaining}]   (my open orders)
GET    /portfolio                                   -> {cash,value,pnl_today,holdings:[{symbol,qty,avg_price,last}],pnl_series:[[ts,value]]}
GET    /trades?symbol=&side=                        -> [{id,order_id,ts,symbol,price,qty,side}]  (my executed trades, newest first; order_id associates fills with their parent order)
GET    /orderlog                                    -> [{ts,id,symbol,side,type,price,qty,status,note}]  (NEW, optional: my order activity: OPEN/PARTIAL/FILLED/CANCELLED/REJECTED, newest first)
GET    /stream?symbol=AAPL&token=TOKEN              -> Server-Sent Events (EventSource cannot set headers, so the token is in the query)
```
Book rules: bids sorted high to low, asks sorted low to high, each level is [price, total quantity at that price].
SSE events (one JSON per `data:` line):
```
{"type":"snapshot","symbol":"AAPL","bids":[[151,300]],"asks":[[151.5,200]],"last":151.25}   (sent first on connect)
{"type":"book","symbol":"AAPL","bids":[...],"asks":[...],"last":151.25}                      (after any book change)
{"type":"trade","symbol":"AAPL","price":151.25,"qty":100,"side":"BUY","ts":1759500000,"mine":false}        (each execution; side = aggressor)
{"type":"fill","order_id":1042,"remaining":60}                                                (my order partially/fully filled)
```

## 5b. Individual trader orders (added)
Individual users now trade in the same book as the bots. The frontend sends LIMIT or MARKET orders; the order form shows available cash/shares and the order book marks price levels that hold the user's own orders ("you" tag).
The mock backend (js/mock.js) is a small JS matching engine that the C++ engine must mirror:
- Price-time priority: bids high->low, asks low->high, FIFO inside a price. Trades execute at the RESTING order's price.
- LIMIT: matches what crosses, the rest rests in the book (status OPEN or PARTIAL). MARKET: sweeps the book, unfilled rest is cancelled; empty book -> error.
- Pre-funded accounts: BUY needs cash (price*qty, minus cash locked by the user's other open BUYs); SELL needs shares (minus shares locked by open SELLs). No short selling. Errors: "Insufficient funds...", "Not enough shares...".
- Self-trade prevention: an order that would match the user's own resting order is rejected.
- Resting orders fill when bot flow reaches them -> SSE {"type":"fill"} event + changes to /orders, /trades, /portfolio.
- Mock account state is kept in sessionStorage key 'tradex-mock' (cleared on logout), so orders/cash/holdings survive page changes.

## 5c. User-listed stocks (added)
Besides the 6 company stocks (bot-driven), any user can list their own stock on the "My Stocks" page (stocks.html).
- Rules: ticker 3-5 capital letters and unique; name 2-40 chars; total shares 100..1,000,000; price > 0; max 3 stocks per user. The creator receives ALL shares as a holding (avg price = starting price) and sells them with normal SELL orders. Everything else (matching, cash/share checks, market orders) is identical to company stocks.
- One independent order book per ticker (C++: unordered_map<string, OrderBook>).
- In the mock, user stocks get thin simulated 'community trader' quotes (5 levels, 0.5% apart) so a single demo user has someone to trade with. A real backend has no bots on user stocks: the book is empty until real users post orders (market orders then return "No sellers/buyers in the book").
- Frontend: the symbol dropdown is built from GET /stocks (cached in sessionStorage 'tradex-stocks'; user stocks show a * after the ticker). Use TX.STOCKS / TX.SYMBOLS / TX.isUserStock(sym), never hardcode the 6 symbols.

## 6. Suggested split between two people
- Person A: css/style.css, utils.js, layout.js, api.js, store.js, login, profile, dashboard.
- Person B: charts.js, trade, orders, portfolio, history, depth pages, mock.js.
Agree on the API contract and TX namespace first; everything else can be built in parallel using mock mode.

## 7. Status and what is left
Done in this document: 8 pages, navbar and menu, login/register with validation, live price/volume/depth/donut/P&L canvas charts, order form, cancel, mock backend and mock live feed.
Left: open in browser and fix any errors, timeframe tabs and candlesticks, table sorting, hover tooltips on charts, flash animation when a price changes, price history that survives page changes (currently resets per page load; could seed from the backend), real backend integration test, final mobile polish.

## 8. Prompt to give another AI agent
"Read this whole document. It is a vanilla HTML/CSS/JavaScript frontend (no frameworks, no build step) for the TradeX stock order book. Recreate the files exactly as given, open it in mock mode, fix any errors, then continue with section 7 without breaking the API contract or the rules in section 2."

## 9. Added later
- History page has an Order activity table (GET /orderlog, new endpoint; History shows a message if the server lacks it).
- Trade events may carry mine:true when the logged-in user was a party; the live feed shows a 'you' tag.
- Click any table header to sort. Last price flashes green/red on change. New mock accounts start with no fake trades.

## 5d. Engine metrics (added: matching speed display)
New page performance.html shows how fast the engine matches. New endpoint (the C++ backend must add it; the page shows a message if it is missing):
```
GET /metrics -> see section 10 (new shape)
```
- orders_total / trades_total: counters since engine start. orders_per_sec: orders matched in the last second (or a short moving average).
- avg_match_us / p99_match_us: time spent inside the matching function per order, in MICROSECONDS (measure with std::chrono::steady_clock around match(), keep a histogram or a ring buffer of the last N durations for p99).
- resting_orders: orders currently sitting in all books.
- The page polls every 1 s and draws two charts. The third chart (my order round-trip, ms) is measured in the browser around POST /order and needs nothing from the backend.
- Mock mode returns simulated numbers and the page labels them MOCK DATA.

## 10. Final merged version (tradex-frontend + pblfront + C++ design PDF)
- Base is tradex-frontend. From pblfront: landing page (index.html), dashboard moved to dashboard.html with the market-watch table (bid/ask/spread, sparklines, watchlist in localStorage), search + sort on tables (TX.interactiveTable), CSV trade report, order confirmation, visible Logout, contact details on Profile, hover details on line charts.
- Aligned with the backend design PDF: POST /order sends `orderType` and `quantity`; order statuses are OPEN, PARTIALLY_FILLED, FILLED, CANCELLED (api.js maps the old PARTIAL, and accepts `quantity`, `remaining_quantity`, `order_type` in responses).
- New endpoints (all optional: the page shows a message or falls back if one is missing):
```
GET /quotes               -> [{symbol,name,last,change_pct,volume}]        (also used for the symbol list if /stocks is missing)
GET /candles/:symbol?tf=1m -> [{t,o,h,l,c,v}] oldest first, t = unix seconds  (seeds the price chart)
GET /receipts             -> [{receipt_id,receipt_number,trade_id,order_id,ts,symbol,side,price,qty,total}]
GET /metrics              -> {uptime_s,orders_total,trades_total,orders_per_sec,avg_match_us,p50_match_us,p95_match_us,p99_match_us,max_match_us,
                              ram_bytes,open_orders, bench_ram_us?,bench_db_us?}
```
- /metrics: latency fields time the matching step only (Metrics.h ScopedTimer + LatencyStats, microseconds); ram_bytes is residentBytes(); bench_* are optional results of the RAM-only vs DB-write-per-trade benchmark. Shown on performance.html and as the "System performance" card on dashboard.html.
- /stocks (user-listed stocks, My Stocks page) is NOT in the C++ design. Keep it only if the team builds it.
- JSON prices are dollars; the engine uses integer cents internally.
- Not tested in a real browser by the author: open index.html and check the console first.
