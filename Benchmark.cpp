#include "engine/Benchmark.h"
#include <chrono>
#include <filesystem>
#include <random>
#include "bots/Bots.h"
#include "persistence/Repository.h"

namespace tx {

// Sends `orders` bot-style orders (from accounts 1001-1100, so every trade counts as a saved user trade) and returns
// the average wall time per order in microseconds. `trades` receives the number of trades that happened.
static double timePerOrder(int seedOrders, int orders, IRepository* repo, long long* trades) {
    TradingEngine e;
    e.seedBook(seedOrders);
    e.setRepository(repo);
    const long long before = e.tradesTotal();
    std::mt19937 rng(1);
    MarketMakerBot mm(1); RandomTakerBot tk(3);
    const auto& syms = TradingEngine::symbols();
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < orders; i++) {
        const std::string& s = syms[rng() % syms.size()];
        BotOrder o = (i % 3 == 0 ? static_cast<Bot&>(tk) : static_cast<Bot&>(mm)).decide(TradingEngine::basePrice(s), rng);
        e.placeBotOrder(1001 + (int)(rng() % 100), s, o.side, o.price, o.qty);
    }
    double us = std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - t0).count() / orders;
    if (trades) *trades = e.tradesTotal() - before;
    return us;
}

BenchResult runBenchmark(int seedOrders, int orders) {
    BenchResult r;
    r.diskOrders = orders;
    r.ramUs = timePerOrder(seedOrders, orders, nullptr, nullptr);
    std::error_code ec;
    auto dir = std::filesystem::temp_directory_path() / "tradex_bench";
    std::filesystem::remove_all(dir, ec);
    std::filesystem::create_directories(dir, ec);
    {
        Database db((dir / "bench.db").string());              // the same database settings as the real server (commit to disk per write)
        SqliteRepository repo(db);
        r.diskUs = timePerOrder(seedOrders, orders, &repo, &r.diskTrades);
    }
    std::filesystem::remove_all(dir, ec);
    r.ready = true;
    return r;
}

}  // namespace tx
