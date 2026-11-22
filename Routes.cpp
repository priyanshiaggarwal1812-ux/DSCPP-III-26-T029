#include "api/Routes.h"
#include <chrono>
#include <cmath>
#include <memory>
#include <thread>
#include <httplib.h>
#include "api/Json.h"

namespace tx {

static double r2(double v) { return std::round(v * 100.0) / 100.0; }
static std::string upper(std::string s) { for (auto& c : s) c = (char)std::toupper((unsigned char)c); return s; }

static void reply(httplib::Response& res, const json& j, int status = 200) {
    res.status = status;
    res.set_content(dump(j), "application/json");
}
static void fail(httplib::Response& res, int status, const std::string& msg) { reply(res, {{"error", msg}}, status); }

// Request body as JSON. False (and a 400 answer) when it is not valid JSON.
static bool parseBody(const httplib::Request& req, httplib::Response& res, json& out) {
    out = json::parse(req.body, nullptr, false);
    if (out.is_discarded() || !out.is_object()) { fail(res, 400, "Request body must be a JSON object"); return false; }
    return true;
}

// Token from "Authorization: Bearer ..." (or ?token=..., because the browser's EventSource cannot send headers).
static bool authOf(const httplib::Request& req, AppContext& c, SessionManager::Session& s, httplib::Response& res) {
    std::string t = req.get_header_value("Authorization");
    t = t.rfind("Bearer ", 0) == 0 ? t.substr(7) : "";
    if (t.empty()) t = req.get_param_value("token");
    if (!t.empty() && c.sessions.get(t, s)) return true;
    fail(res, 401, "Please log in");
    return false;
}

void registerRoutes(httplib::Server& srv, AppContext& ctx) {
    TradingEngine& engine = ctx.engine;

    // ---------- accounts ----------
    auto signIn = [&ctx](httplib::Response& res, const std::string& user, int account) {
        ctx.engine.ensureAccount(account);
        reply(res, {{"token", ctx.sessions.create(account, user)}, {"username", user}, {"account_id", UserManager::accountLabel(account)}});
    };
    srv.Post("/register", [&ctx, signIn](const httplib::Request& req, httplib::Response& res) {
        json b; std::string u, p, err; int acc = 0;
        if (!parseBody(req, res, b)) return;
        if (!getString(b, "username", u) || !getString(b, "password", p)) return fail(res, 400, "username and password are required");
        if (!ctx.users.registerUser(u, p, err, acc)) return fail(res, err == "Username already taken" ? 409 : 400, err);
        signIn(res, u, acc);
    });
    srv.Post("/login", [&ctx, signIn](const httplib::Request& req, httplib::Response& res) {
        json b; std::string u, p, err; int acc = 0;
        if (!parseBody(req, res, b)) return;
        if (!getString(b, "username", u) || !getString(b, "password", p)) return fail(res, 400, "username and password are required");
        if (!ctx.users.login(u, p, err, acc)) return fail(res, 401, err);
        signIn(res, u, acc);
    });
    srv.Post("/password", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s; json b; std::string oldp, newp, err;
        if (!authOf(req, ctx, s, res) || !parseBody(req, res, b)) return;
        if (!getString(b, "old_password", oldp) || !getString(b, "new_password", newp)) return fail(res, 400, "old_password and new_password are required");
        if (!ctx.users.changePassword(s.username, oldp, newp, err)) return fail(res, 400, err);
        reply(res, {{"ok", true}});
    });

    // ---------- market data (public) ----------
    srv.Get(R"(/book/([A-Za-z]+))", [&engine](const httplib::Request& req, httplib::Response& res) {
        BookSnapshot s = engine.snapshot(upper(req.matches[1]), 12);
        if (s.symbol.empty()) return fail(res, 404, "Unknown symbol");
        reply(res, bookJson(nullptr, s));
    });
    srv.Get("/quotes", [&engine](const httplib::Request&, httplib::Response& res) {
        json a = json::array();
        for (const Quote& q : engine.quotes())
            a.push_back({{"symbol", q.symbol}, {"name", q.name}, {"last", r2(q.last)}, {"open", r2(q.open)}, {"high", r2(q.high)}, {"low", r2(q.low)},
                         {"prev_close", r2(q.prevClose)}, {"change", r2(q.change)}, {"change_pct", r2(q.changePct)}, {"volume", q.volume}});
        reply(res, a);
    });
    srv.Get(R"(/candles/([A-Za-z]+))", [&engine](const httplib::Request& req, httplib::Response& res) {
        res.set_content(engine.candlesJson(upper(req.matches[1]), 60), "application/json");   // already JSON text
    });

    // ---------- orders ----------
    srv.Post("/order", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s; json b;
        if (!authOf(req, ctx, s, res) || !parseBody(req, res, b)) return;
        std::string sym, side, type = "LIMIT";
        double price = 0, qty = 0;
        if (!getString(b, "symbol", sym) || !getString(b, "side", side)) return fail(res, 400, "symbol and side are required");
        getString(b, "orderType", type);
        if (!getNumber(b, "qty", qty) && !getNumber(b, "quantity", qty)) return fail(res, 400, "qty is required");
        sym = upper(sym); side = upper(side); type = upper(type);
        if (side != "BUY" && side != "SELL") return fail(res, 400, "side must be BUY or SELL");
        if (type != "LIMIT" && type != "MARKET") return fail(res, 400, "orderType must be LIMIT or MARKET");
        if (type == "LIMIT" && !getNumber(b, "price", price)) return fail(res, 400, "price is required for limit orders");
        if (qty != std::floor(qty) || qty < 1 || qty > 1000000) return fail(res, 400, "Quantity must be a whole number between 1 and 1,000,000");
        if (type == "LIMIT" && (price <= 0 || price > 1000000)) return fail(res, 400, "Price must be greater than 0");
        PlaceResult r = ctx.engine.placeOrder(s.account, sym, side == "BUY" ? Side::Buy : Side::Sell,
                                              type == "LIMIT" ? OrderType::Limit : OrderType::Market, type == "LIMIT" ? toCents(price) : 0, (int)qty);
        if (!r.ok) return fail(res, 400, r.error);
        reply(res, {{"order_id", r.orderId}, {"status", r.status}, {"filled", r.filled}});
    });
    srv.Delete(R"(/order/(\d{1,12}))", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        std::string err;
        if (!ctx.engine.cancelOrder(std::stol(req.matches[1]), s.account, err)) return fail(res, err == "Not your order" ? 403 : 404, err);
        reply(res, {{"ok", true}});
    });
    srv.Get("/orders", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        json a = json::array();
        for (const OrderInfo& i : ctx.engine.openOrders(s.account))
            a.push_back({{"id", i.id}, {"symbol", i.symbol}, {"side", sideStr(i.side)}, {"price", i.price / 100.0}, {"qty", i.qty}, {"remaining", i.remaining}});
        reply(res, a);
    });
    srv.Get("/orderlog", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        json a = json::array();
        for (const OrderLogEntry& l : ctx.engine.userOrderLog(s.account, 100))
            a.push_back({{"ts", (long long)l.ts}, {"id", l.id}, {"symbol", l.symbol}, {"side", l.side}, {"type", l.type}, {"price", r2(l.price)},
                         {"qty", l.qty}, {"status", l.status}, {"note", l.note}});
        reply(res, a);
    });
    srv.Get("/portfolio", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        PortfolioView v = ctx.engine.portfolio(s.account);
        json holdings = json::array(), series = json::array();
        for (const HoldingView& h : v.holdings)
            holdings.push_back({{"symbol", h.symbol}, {"qty", h.qty}, {"avg_price", r2(h.avgCost)}, {"last", r2(h.last)}});
        for (const auto& p : v.series) series.push_back(json::array({(long long)p.first, r2(p.second)}));
        reply(res, {{"cash", r2(v.cash)}, {"value", r2(v.value)}, {"pnl_today", r2(v.pnlToday)}, {"holdings", holdings}, {"pnl_series", series}});
    });
    srv.Get("/trades", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        const std::string side = upper(req.get_param_value("side"));
        const int filter = side == "BUY" ? 0 : side == "SELL" ? 1 : -1;
        json a = json::array();
        for (const Trade& t : ctx.engine.userTrades(s.account, upper(req.get_param_value("symbol")), filter, 500)) {
            const bool buyer = t.buyerAcc == s.account;
            a.push_back({{"id", t.id}, {"order_id", buyer ? t.buyOrderId : t.sellOrderId}, {"ts", (long long)t.ts}, {"symbol", t.symbol},
                         {"price", t.price / 100.0}, {"qty", t.qty}, {"side", buyer ? "BUY" : "SELL"}});
        }
        reply(res, a);
    });
    srv.Get("/receipts", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        json a = json::array();
        for (const ReceiptView& r : ctx.engine.receipts(s.account, 200))
            a.push_back({{"number", r.number}, {"receipt_number", r.number}, {"receipt_id", r.number}, {"trade_id", r.tradeId}, {"order_id", r.orderId},
                         {"ts", (long long)r.ts}, {"symbol", r.symbol}, {"side", sideStr(r.side)}, {"qty", r.qty}, {"price", r.price},
                         {"total", r2(r.total)}, {"status", "EXECUTED"}});
        reply(res, a);
    });

    // ---------- ledger audit: re-reads the trades table and checks the SHA-256 chain ----------
    srv.Get("/verify", [&engine](const httplib::Request&, httplib::Response& res) {
        VerifyResult v = engine.verifyLedger();
        if (v.valid)
            return reply(res, {{"valid", true}, {"count", v.count}, {"last_hash", v.lastHash}, {"genesis_hash", GENESIS_HASH},
                               {"verified_at", (long long)std::time(nullptr)}});
        reply(res, {{"valid", false}, {"count", v.count}, {"broken_at_trade_id", v.brokenAtId}, {"error", v.error}});
    });

    // ---------- speed counters (flat fields) ----------
    srv.Get("/metrics", [&ctx](const httplib::Request&, httplib::Response& res) {
        LatencyStats::Snapshot m = ctx.engine.matchStats.snapshot();
        json j = {{"uptime_s", (long long)ctx.engine.uptimeSeconds()}, {"orders_total", ctx.engine.orderStats.total()},
                  {"trades_total", ctx.engine.tradesTotal()}, {"orders_per_sec", std::round(ctx.engine.ordersPerSec() * 10) / 10},
                  {"avg_match_us", r2(m.avg_us)}, {"p50_match_us", r2(m.p50_us)}, {"p95_match_us", r2(m.p95_us)},
                  {"p99_match_us", r2(m.p99_us)}, {"max_match_us", r2(m.max_us)}, {"ram_bytes", residentBytes()},
                  {"open_orders", ctx.engine.openOrderCount()}, {"bot_orders_sent", ctx.bots.ordersSent()},
                  {"stream_clients", ctx.streamClients.load()}};
        BenchResult b = ctx.bench.get();
        if (b.ready) {                                               // measured once at start-up (see engine/Benchmark.cpp)
            j["bench_ram_us"] = r2(b.ramUs); j["bench_db_us"] = r2(b.diskUs); j["bench_disk_orders"] = b.diskOrders;
        }
        reply(res, j);
    });

    // ---------- live stream (Server-Sent Events) ----------
    // No hub and no condition variables: each connection runs its own loop and asks the engine what changed every 250 ms.
    srv.Get("/stream", [&ctx](const httplib::Request& req, httplib::Response& res) {
        SessionManager::Session s;
        if (!authOf(req, ctx, s, res)) return;
        std::string sym = upper(req.get_param_value("symbol"));
        if (sym.empty()) sym = "AAPL";
        BookSnapshot snap = ctx.engine.snapshot(sym, 12);
        if (snap.symbol.empty()) return fail(res, 400, "Unknown symbol");

        struct State { std::string sym; int account; long seq, version; int quiet = 0; bool first = true; };
        auto st = std::make_shared<State>(State{sym, s.account, ctx.engine.feedSeq(), ctx.engine.bookVersion(sym)});
        ctx.streamClients++;
        res.set_header("Cache-Control", "no-cache");
        res.set_chunked_content_provider(
            "text/event-stream",
            [&ctx, st, snap](size_t, httplib::DataSink& sink) {
                if (ctx.stopping) return false;
                std::string out;
                if (st->first) { st->first = false; out = "retry: 3000\n\ndata: " + dump(bookJson("snapshot", snap)) + "\n\n"; }
                else {
                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                    for (const Trade& t : ctx.engine.tradesSince(st->sym, st->seq)) {
                        const bool buyer = t.buyerAcc == st->account, seller = t.sellerAcc == st->account;
                        out += "data: " + dump(tradeEvent(t, buyer || seller)) + "\n\n";           // "mine" tells the page this was the user's trade
                        if (buyer) out += "data: " + dump(fillEvent(t.buyOrderId, t.buyRemaining)) + "\n\n";
                        if (seller) out += "data: " + dump(fillEvent(t.sellOrderId, t.sellRemaining)) + "\n\n";
                    }
                    const long v = ctx.engine.bookVersion(st->sym);
                    if (v != st->version) { st->version = v; out += "data: " + dump(bookJson("book", ctx.engine.snapshot(st->sym, 12))) + "\n\n"; }
                    if (out.empty()) {
                        if (++st->quiet < 60) return true;                                          // nothing new: poll again
                        out = ": ping\n\n";                                                         // keep-alive comment every 15 s
                    }
                    st->quiet = 0;
                }
                return sink.write(out.data(), out.size());                                          // false = the browser went away
            },
            [&ctx](bool) { ctx.streamClients--; });
    });
}

}  // namespace tx
