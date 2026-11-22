// Tests for the order book, matching engine, risk checks, cancellation, recovery, and hash ledger.
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>
#include "engine/TradingEngine.h"
using namespace tx;
static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); failures++; } } while (0)
static const int USER = 1001, USER2 = 1002;

static void test_fifo_and_partial() {
    TradingEngine e;
    e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 100);          // bot 1 first
    e.placeBotOrder(2, "AAPL", Side::Sell, 15150, 100);          // bot 2 second, same price
    auto r = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 150);
    CHECK(r.ok && r.status == "FILLED" && r.filled == 150);
    auto snap = e.snapshot("AAPL");
    CHECK(snap.asks.size() == 1 && snap.asks[0].qty == 50);       // bot 1 fully filled first, bot 2 left with 50
    CHECK(e.userTrades(USER, "", -1, 10).size() == 2);
}

static void test_partial_rests_in_book() {
    TradingEngine e;
    e.placeBotOrder(1, "MSFT", Side::Sell, 41200, 60);
    auto r = e.placeOrder(USER, "MSFT", Side::Buy, OrderType::Limit, 41200, 100);
    CHECK(r.ok && r.status == "PARTIALLY_FILLED" && r.filled == 60);
    auto open = e.openOrders(USER);
    CHECK(open.size() == 1 && open[0].remaining == 40);
    auto snap = e.snapshot("MSFT");
    CHECK(snap.asks.empty() && snap.bids.size() == 1 && snap.bids[0].qty == 40);   // empty ask level cleaned up
}

static void test_market_sweep_levels() {
    TradingEngine e;
    e.placeBotOrder(1, "TSLA", Side::Sell, 24800, 50);
    e.placeBotOrder(2, "TSLA", Side::Sell, 24900, 30);
    e.placeBotOrder(3, "TSLA", Side::Sell, 25000, 20);
    auto r = e.placeOrder(USER, "TSLA", Side::Buy, OrderType::Market, 0, 100);
    CHECK(r.ok && r.status == "FILLED" && r.filled == 100);
    auto t = e.userTrades(USER, "TSLA", -1, 10);
    CHECK(t.size() == 3 && t[0].price == 25000 && t[1].price == 24900 && t[2].price == 24800);   // newest first
    CHECK(e.snapshot("TSLA").asks.empty());
}

static void test_market_edge_cases() {
    TradingEngine e;
    auto r = e.placeOrder(USER, "GOOG", Side::Buy, OrderType::Market, 0, 10);
    CHECK(!r.ok && r.error == "No sellers available");            // empty book is rejected
    e.placeBotOrder(1, "GOOG", Side::Sell, 17100, 5);
    r = e.placeOrder(USER, "GOOG", Side::Buy, OrderType::Market, 0, 10);
    CHECK(r.ok && r.status == "PARTIALLY_FILLED" && r.filled == 5);   // rest is cancelled, not resting
    CHECK(e.openOrders(USER).empty());
}

static void test_price_priority() {
    TradingEngine e;
    e.placeBotOrder(1, "AMZN", Side::Sell, 18600, 10);
    e.placeBotOrder(2, "AMZN", Side::Sell, 18500, 10);           // better price arrives later
    auto r = e.placeOrder(USER, "AMZN", Side::Buy, OrderType::Limit, 18600, 10);
    CHECK(r.filled == 10);
    auto t = e.userTrades(USER, "AMZN", -1, 5);
    CHECK(t.size() == 1 && t[0].price == 18500);                  // best price first, at the resting price
    auto r2 = e.placeOrder(USER, "AMZN", Side::Buy, OrderType::Limit, 18400, 5);   // does not cross
    CHECK(r2.status == "OPEN" && r2.filled == 0);
}

static void test_cancel() {
    TradingEngine e;
    auto r = e.placeOrder(USER, "NVDA", Side::Buy, OrderType::Limit, 11900, 10);
    std::string err;
    CHECK(!e.cancelOrder(r.orderId, USER2, err) && err == "Not your order");
    CHECK(e.cancelOrder(r.orderId, USER, err));
    CHECK(!e.cancelOrder(r.orderId, USER, err) && err == "Order not found");
    CHECK(e.openOrders(USER).empty() && e.snapshot("NVDA").bids.empty());
}

static void test_risk_and_accounts() {
    TradingEngine e;
    auto r = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15100, 100000);
    CHECK(!r.ok && r.error == "Insufficient cash");
    r = e.placeOrder(USER, "AAPL", Side::Sell, OrderType::Limit, 15100, 101);
    CHECK(!r.ok && r.error == "Not enough shares to sell");        // only 100 starter shares
    r = e.placeOrder(USER, "XXXX", Side::Buy, OrderType::Limit, 100, 1);
    CHECK(!r.ok && r.error == "Unknown symbol");
    e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 100);
    r = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 100);
    CHECK(r.ok && r.filled == 100);
    auto p = e.portfolio(USER);
    CHECK(p.cash > 84849.99 && p.cash < 84850.01);                // 100000 - 15150
    bool found = false;
    for (auto& h : p.holdings) if (h.symbol == "AAPL") { found = true; CHECK(h.qty == 200); }
    CHECK(found);
    auto rc = e.receipts(USER, 10);
    CHECK(rc.size() == 1 && rc[0].qty == 100 && rc[0].side == Side::Buy);
    CHECK(rc[0].orderId == r.orderId);
}

static void test_reserved_funds() {
    TradingEngine e;
    auto r1 = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15000, 600);   // reserves $90,000
    CHECK(r1.ok);
    auto r2 = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15000, 100);   // only $10,000 left
    CHECK(!r2.ok && r2.error == "Insufficient cash");
    auto r3 = e.placeOrder(USER, "MSFT", Side::Sell, OrderType::Limit, 99999, 100);
    auto r4 = e.placeOrder(USER, "MSFT", Side::Sell, OrderType::Limit, 99999, 1);    // shares already reserved
    CHECK(r3.ok && !r4.ok);
}

static void test_replay_and_metrics() {
    TradingEngine a;
    a.placeBotOrder(1, "AAPL", Side::Sell, 15150, 100);
    a.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 100);
    auto trades = a.userTrades(USER, "", -1, 10);
    CHECK(a.orderStats.snapshot().samples >= 2 && a.matchStats.snapshot().samples >= 2);
    TradingEngine b;                                              // "restart": rebuild from saved trades
    for (auto it = trades.rbegin(); it != trades.rend(); ++it) b.replayTrade(*it);
    auto p = b.portfolio(USER);
    CHECK(p.cash > 84849.99 && p.cash < 84850.01);
    CHECK(b.userTrades(USER, "", -1, 10).size() == 1);
}

static void test_ledger_chain() {
    TradingEngine e;
    e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 50);
    e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 50);
    e.placeBotOrder(2, "MSFT", Side::Sell, 41200, 30);
    e.placeOrder(USER, "MSFT", Side::Buy, OrderType::Limit, 41200, 30);
    e.placeBotOrder(3, "TSLA", Side::Sell, 24800, 10);        // bot-only trade: not saved, not in the chain
    e.placeBotOrder(4, "TSLA", Side::Buy, 24800, 10);
    auto v = e.verifyLedger();
    CHECK(v.valid && v.count == 2 && v.lastHash.size() == 64);
    auto t = e.userTrades(USER, "", -1, 10);                  // newest first
    CHECK(t.size() == 2 && t[1].prevHash == GENESIS_HASH && t[0].prevHash == t[1].hash);
}

static void test_open_orders_survive_restart() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_open").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    const std::string file = dir + "/tradex.db";
    long keep = 0, partial = 0, gone = 0;
    {
        Database db(file); SqliteRepository repo(db);
        TradingEngine e; e.setRepository(&repo);
        keep = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 14000, 20).orderId;       // rests untouched
        partial = e.placeOrder(USER, "MSFT", Side::Sell, OrderType::Limit, 41300, 30).orderId;   // will be partly filled
        gone = e.placeOrder(USER, "TSLA", Side::Buy, OrderType::Limit, 20000, 5).orderId;
        std::string err;
        CHECK(e.cancelOrder(gone, USER, err));
        e.placeBotOrder(1, "MSFT", Side::Buy, 41300, 12);                                        // buys 12 of the 30
        CHECK(e.openOrders(USER).size() == 2);
    }
    {
        Database db(file); SqliteRepository repo(db);
        TradingEngine e;
        for (auto& t : repo.loadTrades()) e.replayTrade(t);
        e.setRepository(&repo);
        CHECK(e.restoreOpenOrders() == 2);
        auto open = e.openOrders(USER);
        CHECK(open.size() == 2);
        for (auto& o : open) {
            if (o.id == keep) CHECK(o.remaining == 20 && o.qty == 20);
            else if (o.id == partial) CHECK(o.remaining == 18 && o.qty == 30);
            else CHECK(false);
        }
        CHECK(e.snapshot("AAPL").bids.size() == 1);                                              // really back in the book
        e.placeBotOrder(1, "MSFT", Side::Buy, 41300, 18);                                        // finishes the partial order
        CHECK(e.openOrders(USER).size() == 1);
    }
    {   // a later restart must not bring back the finished order
        Database db(file); SqliteRepository repo(db);
        TradingEngine e;
        for (auto& t : repo.loadTrades()) e.replayTrade(t);
        e.setRepository(&repo);
        CHECK(e.restoreOpenOrders() == 1 && e.openOrders(USER).size() == 1 && e.openOrders(USER)[0].id == keep);
        CHECK(e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 14000, 1).orderId > keep);   // new ids do not reuse old ones
    }
}

static void test_history_and_atomic_cancel() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_hist").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    const std::string file = dir + "/tradex.db";
    long resting = 0;
    {
        Database db(file); SqliteRepository repo(db);
        TradingEngine e; e.setRepository(&repo);
        CHECK(!e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15000, 1000000).ok);       // rejected: no cash
        resting = e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 14000, 10).orderId;
        std::string err;
        CHECK(db.run("ALTER TABLE order_log RENAME TO order_log_x"));                              // make the database refuse the cancel
        CHECK(!e.cancelOrder(resting, USER, err) && e.openOrders(USER).size() == 1);              // nothing changed anywhere
        CHECK(db.run("ALTER TABLE order_log_x RENAME TO order_log"));
        int still = 0; db.run("SELECT COUNT(*) FROM open_orders", {}, [&](sqlite3_stmt* r) { still = (int)Database::num(r, 0); });
        CHECK(still == 1);
        CHECK(e.cancelOrder(resting, USER, err) && e.openOrders(USER).empty());
        db.run("SELECT COUNT(*) FROM open_orders", {}, [&](sqlite3_stmt* r) { still = (int)Database::num(r, 0); });
        CHECK(still == 0);                                                                         // delete and history line came together
    }
    {
        Database db(file); SqliteRepository repo(db);
        TradingEngine e; e.setRepository(&repo);
        e.restoreOrderLog();
        auto log = e.userOrderLog(USER, 10);
        CHECK(log.size() == 3 && log[0].status == "CANCELLED" && log[1].status == "OPEN" && log[2].status == "REJECTED");   // newest first
        CHECK(log[0].price == 140.0 && log[0].qty == 10 && log[2].note == "Insufficient cash");
        CHECK(e.restoreOpenOrders() == 0);
    }
}

static void test_ledger_db_tamper_and_restart() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_ledger").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    const std::string file = dir + "/tradex.db";
    {
        Database db(file); SqliteRepository repo(db);
        TradingEngine e;
        e.setRepository(&repo);
        for (int i = 0; i < 5; i++) {
            e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 10);
            e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 10);
        }
        CHECK(e.verifyLedger().valid && e.verifyLedger().count == 5);
    }
    {   // restart: reload from the database file, keep trading, the chain must continue without a break
        Database db(file); SqliteRepository repo(db);
        TradingEngine e;
        auto saved = repo.loadTrades();
        CHECK(saved.size() == 5 && verifyChain(saved).valid);
        for (auto& t : saved) e.replayTrade(t);
        e.setRepository(&repo);
        CHECK(e.portfolio(USER).cash > 100000.0 - 5 * 1515.0 - 1 && e.portfolio(USER).cash < 100000.0 - 5 * 1515.0 + 1);
        e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 10);
        e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 10);
        auto v = e.verifyLedger();
        CHECK(v.valid && v.count == 6);
    }
    {   // tamper: somebody edits the quantity of trade 3 directly in the database
        Database db(file); SqliteRepository repo(db);
        CHECK(db.run("UPDATE trades SET qty=9 WHERE id=3"));
        auto v = verifyChain(repo.loadTrades());
        CHECK(!v.valid && v.brokenAtId == 3);
        TradingEngine e; e.setRepository(&repo);
        CHECK(!e.verifyLedger().valid);
    }
}

static void test_candles_are_real() {
    TradingEngine e;
    e.placeBotOrder(1, "AAPL", Side::Sell, 15200, 100);
    e.placeBotOrder(2, "AAPL", Side::Buy, 15200, 40);          // trade at 152.00
    e.placeBotOrder(3, "AAPL", Side::Buy, 15200, 10);
    std::string j = e.candlesJson("AAPL", 3);
    CHECK(j.find("\"c\":152.00") != std::string::npos && j.find("\"v\":50") != std::string::npos);
    CHECK(j.find("\"v\":0") != std::string::npos);            // the minutes before the first trade are flat, volume 0
    CHECK(e.candlesJson("NOPE", 3) == "[]");
}

static void test_stream_feed() {
    TradingEngine e;
    long seq = e.feedSeq();
    long v0 = e.bookVersion("AAPL");
    e.placeBotOrder(1, "AAPL", Side::Sell, 15150, 10);
    CHECK(e.bookVersion("AAPL") > v0);
    CHECK(e.tradesSince("AAPL", seq).empty());
    e.placeOrder(USER, "AAPL", Side::Buy, OrderType::Limit, 15150, 10);
    long seq2 = seq;
    auto t = e.tradesSince("AAPL", seq2);
    CHECK(t.size() == 1 && t[0].buyerAcc == USER && seq2 > seq);
    CHECK(e.tradesSince("AAPL", seq2).empty());                 // nothing new the second time
    CHECK(e.tradesSince("MSFT", seq).empty());                  // other symbol
}

static void test_seed_and_stress() {
    TradingEngine e;
    CHECK(e.seedBook(20000) == 20000 && e.openOrderCount() == 20000);   // seed does not cross, nothing trades
    CHECK(e.tradesTotal() == 0);
    for (int i = 0; i < 20000; i++) e.placeBotOrder(1 + i % 1000, "AAPL", i % 2 ? Side::Buy : Side::Sell, 15100 + (i % 41) - 20, 10 + i % 50);
    auto s = e.snapshot("AAPL");
    CHECK(!s.bids.empty() && !s.asks.empty() && s.bids[0].price < s.asks[0].price);   // book never stays crossed
}

int main() {
    test_fifo_and_partial(); test_partial_rests_in_book(); test_market_sweep_levels(); test_market_edge_cases();
    test_price_priority(); test_cancel(); test_risk_and_accounts(); test_reserved_funds(); test_replay_and_metrics();
    test_ledger_chain(); test_ledger_db_tamper_and_restart(); test_open_orders_survive_restart(); test_history_and_atomic_cancel(); test_candles_are_real(); test_stream_feed();
    test_seed_and_stress();
    std::printf(failures ? "Engine tests: %d FAILED\n" : "Engine tests: all passed\n", failures);
    return failures ? 1 : 0;
}
