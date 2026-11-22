#include "bots/Bots.h"
#include <chrono>

namespace tx {

BotOrder MarketMakerBot::decide(Price ref, std::mt19937& rng) {
    std::uniform_real_distribution<double> u(0.0, 1.0);
    std::uniform_int_distribution<int> q(20, 300);
    const double off = 0.0005 + u(rng) * 0.006;                  // 0.05% to 0.65% away from the reference
    const bool buy = u(rng) < 0.5;
    return BotOrder{buy ? Side::Buy : Side::Sell, around(ref, buy ? -off : off), q(rng)};
}

BotOrder RandomTakerBot::decide(Price ref, std::mt19937& rng) {
    std::uniform_real_distribution<double> u(0.0, 1.0);
    std::uniform_int_distribution<int> q(10, 200);
    const double off = 0.0005 + u(rng) * 0.004;                  // willing to pay up to 0.45% through the reference
    const bool buy = u(rng) < 0.5;
    return BotOrder{buy ? Side::Buy : Side::Sell, around(ref, buy ? off : -off), q(rng)};
}

BotManager::BotManager(TradingEngine& e, SimulatedPriceSource& p) : engine_(e), prices_(p) {
    for (int id = 1; id <= 1000; id++) {                         // bot account numbers 1..1000
        if (id % 3 == 0) bots_.push_back(std::make_unique<RandomTakerBot>(id));
        else bots_.push_back(std::make_unique<MarketMakerBot>(id));
    }
}

void BotManager::start() {
    if (running_.exchange(true)) return;
    th_ = std::thread([this] { run(); });
}

void BotManager::stop() {
    if (!running_.exchange(false)) return;
    if (th_.joinable()) th_.join();
}

void BotManager::run() {
    std::mt19937 rng{std::random_device{}()};
    auto lastStep = std::chrono::steady_clock::now(), lastRequote = lastStep;
    const auto& syms = TradingEngine::symbols();
    while (running_) {
        const std::string& sym = syms[rng() % syms.size()];
        Bot& bot = *bots_[rng() % bots_.size()];
        BotOrder o = bot.decide(prices_.get(sym), rng);
        engine_.placeBotOrder(bot.id(), sym, o.side, o.price, o.qty);
        sent_++;

        auto now = std::chrono::steady_clock::now();
        if (now - lastStep > std::chrono::seconds(1)) { prices_.step(rng); engine_.sampleRate(); lastStep = now; }
        if (now - lastRequote > std::chrono::seconds(5)) {
            for (const auto& s : syms) {
                Price ref = prices_.get(s);
                engine_.cancelStaleBotOrders(s, (Price)(ref * 0.975), (Price)(ref * 1.025));
            }
            lastRequote = now;
        }
        // sleep 200-500 ms in small pieces so stop() returns quickly
        for (int ms = 200 + (int)(rng() % 301); ms > 0 && running_; ms -= 20) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
}

}  // namespace tx
