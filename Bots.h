#pragma once
#include <atomic>
#include <memory>
#include <random>
#include <thread>
#include <vector>
#include "engine/TradingEngine.h"
#include "market/PriceSource.h"

namespace tx {

struct BotOrder { Side side; Price price; int qty; };

// Base class: a strategy decides what to quote given the reference price. (Inheritance + polymorphism)
class Bot {
public:
    explicit Bot(int id) : id_(id) {}
    virtual ~Bot() = default;
    int id() const { return id_; }
    virtual BotOrder decide(Price reference, std::mt19937& rng) = 0;
protected:
    static Price around(Price ref, double fraction) { return (Price)std::llround((double)ref * (1.0 + fraction)); }
    int id_;
};

// Posts passive orders a little away from the reference price: this builds the order book.
class MarketMakerBot : public Bot {
public:
    using Bot::Bot;
    BotOrder decide(Price ref, std::mt19937& rng) override;
};

// Sends orders priced to cross the spread: these cause trades.
class RandomTakerBot : public Bot {
public:
    using Bot::Bot;
    BotOrder decide(Price ref, std::mt19937& rng) override;
};

// Runs ONE thread that keeps the market moving: pick a bot, ask it for an order, send it to the engine.
// Once a second it moves the simulated price and updates the orders-per-second counter;
// every 5 seconds it cancels bot orders that drifted too far from the price.
class BotManager {
public:
    BotManager(TradingEngine& engine, SimulatedPriceSource& prices);
    ~BotManager() { stop(); }
    void start();
    void stop();
    long long ordersSent() const { return sent_.load(); }
private:
    void run();
    TradingEngine& engine_;
    SimulatedPriceSource& prices_;
    std::vector<std::unique_ptr<Bot>> bots_;
    std::thread th_;
    std::atomic<bool> running_{false};
    std::atomic<long long> sent_{0};
};

}  // namespace tx
