#pragma once
#include <atomic>
#include <chrono>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>
#include "book/OrderBook.h"
#include "common/Metrics.h"
#include "common/Types.h"
#include "domain/Account.h"
#include "domain/Ledger.h"
#include "domain/Order.h"
#include "domain/Trade.h"
#include "persistence/Repository.h"

namespace tx {

struct PlaceResult { bool ok = false; std::string error; long orderId = 0; std::string status; int filled = 0; };
struct OrderInfo { long id; std::string symbol; Side side; Price price; int qty; int remaining; };
struct Quote { std::string symbol, name; double last, open, high, low, prevClose, change, changePct; long long volume; };
struct ReceiptView { std::string number; long tradeId; long orderId = 0; std::time_t ts; std::string symbol; Side side; int qty; double price, total; };
struct HoldingView { std::string symbol; int qty; double avgCost, last; };
struct PortfolioView {
    double cash = 0, value = 0, pnlToday = 0;
    std::vector<HoldingView> holdings;
    std::vector<std::pair<std::time_t, double>> series;
};

// Owns every order book and every account.
// Concurrency model: ONE mutex protects everything. Every public method takes it, so the HTTP threads and the bot thread
// never touch the books at the same time. (Simple on purpose: easy to explain and to reason about.)
class TradingEngine {
public:
    TradingEngine();

    static const std::vector<std::string>& symbols();                 // the 6 fixed stocks
    static std::string companyName(const std::string& sym);
    static Price basePrice(const std::string& sym);

    void setRepository(IRepository* r) { std::lock_guard<std::mutex> g(m_); repo_ = r; }

    // ---- orders from users (cash and share checks apply) ----
    PlaceResult placeOrder(int account, const std::string& symbol, Side side, OrderType type, Price price, int qty);
    bool cancelOrder(long orderId, int account, std::string& error);

    // ---- orders from bots (no checks) ----
    void placeBotOrder(int botId, const std::string& symbol, Side side, Price price, int qty);
    int cancelStaleBotOrders(const std::string& symbol, Price lo, Price hi);
    void restoreOrderLog();                                           // after a restart: reload the order history
    int restoreOpenOrders();                                          // after a restart: put saved resting user orders back in the books
    int seedBook(int totalOrders);                                    // fills the books with resting bot orders at start

    // ---- queries ----
    BookSnapshot snapshot(const std::string& symbol, int depth = 12) const;
    std::vector<Quote> quotes() const;
    std::vector<OrderInfo> openOrders(int account) const;
    std::vector<Trade> userTrades(int account, const std::string& symbol, int sideFilter, size_t limit) const;  // newest first; sideFilter -1 all, 0 buy, 1 sell
    std::vector<ReceiptView> receipts(int account, size_t limit) const;
    std::vector<OrderLogEntry> userOrderLog(int account, size_t limit) const;
    VerifyResult verifyLedger() const;                                // re-reads the trades table and checks the hash chain
    std::string candlesJson(const std::string& sym, int count = 60) const;
    PortfolioView portfolio(int account);
    size_t openOrderCount() const;
    long long tradesTotal() const { return tradesTotal_.load(); }
    double uptimeSeconds() const;

    // ---- accounts and recovery ----
    void ensureAccount(int account);
    void replayTrade(const Trade& t);                                 // rebuild balances from saved trades after a restart

    // ---- live feed for the /stream handlers: they poll these every 250 ms ----
    long feedSeq() const;                                             // number of the newest trade
    std::vector<Trade> tradesSince(const std::string& sym, long& seq) const;   // new trades of one symbol, advances seq
    long bookVersion(const std::string& sym) const;                   // changes whenever that book changes

    // ---- speed counters ----
    void sampleRate();                                                // call once per second; keeps orders_per_sec
    double ordersPerSec() const { return rate_.load(); }
    LatencyStats matchStats;                                          // time inside MatchingEngine::match
    LatencyStats orderStats;                                          // whole engine path of one order

private:
    struct Stats { Price open = 0, high = 0, low = 0, prevClose = 0; long long volume = 0; };
    struct Candle { std::time_t t; Price o, h, l, c; long long v; };
    struct Fed { long seq; Trade trade; };

    Account& accountFor(int account);                                 // lock must be held
    double valueOf(const Account& a) const;
    PlaceResult submitLocked(const OrderPtr& o);
    void recordTrade(const Trade& t);
    void applyFill(Account& a, const Trade& t, bool isBuyer);
    std::string riskCheck(const Account& a, int account, const std::string& sym, Side side, double neededCash, int qty) const;
    double estimateMarketCost(const OrderBook& book, Side side, int qty, int& available) const;
    bool addOrderLog(int account, long id, const std::string& symbol, const std::string& side, const std::string& type,
                     double price, int qty, const std::string& status, const std::string& note, long dropOpenOrder = 0);
    void updateCandle(const Trade& t);

    mutable std::mutex m_;
    IRepository* repo_ = nullptr;
    std::map<std::string, std::unique_ptr<OrderBook>> books_;
    std::map<std::string, Price> last_;
    std::map<std::string, Stats> stats_;
    std::map<std::string, std::deque<Candle>> candles_;               // 1-minute candles built from real trades
    std::map<std::string, long> version_;                             // per book change counter
    std::unordered_map<int, Account> accounts_;
    std::unordered_map<int, std::map<long, OrderPtr>> open_;          // each user's resting orders (used for reserved funds)
    std::vector<Trade> ledger_;                                       // trades with a real user: these form the hash chain
    std::string lastTradeHash_ = GENESIS_HASH;
    std::deque<Fed> recent_;                                          // last trades of all symbols, for the live stream
    std::deque<OrderLogEntry> orderLog_;
    long nextOrderId_ = 1000;
    long nextTradeId_ = 1;
    long feedSeq_ = 0;
    std::atomic<long long> tradesTotal_{0};
    std::atomic<double> rate_{0};
    size_t lastRateTotal_ = 0;
    std::chrono::steady_clock::time_point lastRateTime_, started_;
};

}  // namespace tx
