#include "engine/TradingEngine.h"
#include <algorithm>
#include <cmath>
#include <ctime>
#include <random>
#include "engine/MatchingEngine.h"

namespace tx {

static const size_t MAX_RESTING_ORDERS = 100000;     // per book: protects RAM from unbounded growth
static const size_t FEED_KEEP = 2000;                // trades kept for the live stream
static const size_t CANDLES_KEEP = 240;              // minutes of candles kept per symbol

const std::vector<std::string>& TradingEngine::symbols() {
    static const std::vector<std::string> s = {"AAPL", "MSFT", "TSLA", "GOOG", "AMZN", "NVDA"};
    return s;
}
std::string TradingEngine::companyName(const std::string& s) {
    static const std::map<std::string, std::string> n = {
        {"AAPL", "Apple Inc."}, {"MSFT", "Microsoft Corp."}, {"TSLA", "Tesla Inc."},
        {"GOOG", "Alphabet Inc."}, {"AMZN", "Amazon.com Inc."}, {"NVDA", "NVIDIA Corp."}};
    auto it = n.find(s);
    return it == n.end() ? s : it->second;
}
Price TradingEngine::basePrice(const std::string& s) {
    static const std::map<std::string, Price> b = {
        {"AAPL", 15100}, {"MSFT", 41200}, {"TSLA", 24800}, {"GOOG", 17100}, {"AMZN", 18500}, {"NVDA", 12000}};
    auto it = b.find(s);
    return it == b.end() ? 10000 : it->second;
}

TradingEngine::TradingEngine() : started_(std::chrono::steady_clock::now()) {
    lastRateTime_ = started_;
    for (const auto& s : symbols()) {
        books_[s] = std::make_unique<OrderBook>(s);
        last_[s] = basePrice(s);
        version_[s] = 0;
        Stats st; st.open = st.high = st.low = st.prevClose = basePrice(s);
        stats_[s] = st;
    }
}

double TradingEngine::uptimeSeconds() const {
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - started_).count();
}

// orders_per_sec: the bot thread calls this once a second, so the number is the same no matter how many browsers ask for it.
void TradingEngine::sampleRate() {
    auto now = std::chrono::steady_clock::now();
    double secs = std::chrono::duration<double>(now - lastRateTime_).count();
    if (secs < 0.5) return;
    size_t total = orderStats.total();
    rate_ = (double)(total - lastRateTotal_) / secs;
    lastRateTotal_ = total;
    lastRateTime_ = now;
}

double TradingEngine::valueOf(const Account& a) const {
    double v = a.cash();
    for (const auto& kv : a.holdings()) {
        auto it = last_.find(kv.first);
        if (it != last_.end()) v += kv.second.qty * it->second / 100.0;
    }
    return v;
}

Account& TradingEngine::accountFor(int id) {
    auto it = accounts_.find(id);
    if (it != accounts_.end()) return it->second;
    Account a(id);
    for (const auto& s : symbols()) a.grantShares(s, 100, basePrice(s) / 100.0);   // starter portfolio: 100 shares of each stock
    a.setStartValue(valueOf(a));
    a.record(std::time(nullptr), a.startValue());
    return accounts_.emplace(id, std::move(a)).first->second;
}

void TradingEngine::ensureAccount(int id) {
    std::lock_guard<std::mutex> g(m_);
    accountFor(id);
}

void TradingEngine::applyFill(Account& a, const Trade& t, bool isBuyer) {
    const double px = t.price / 100.0;
    if (isBuyer) a.applyBuy(t.symbol, t.qty, px); else a.applySell(t.symbol, t.qty, px);
    a.record(t.ts, valueOf(a));
}

bool TradingEngine::addOrderLog(int account, long id, const std::string& symbol, const std::string& side, const std::string& type,
                                double price, int qty, const std::string& status, const std::string& note, long dropOpenOrder) {
    OrderLogEntry e;
    e.ts = std::time(nullptr); e.id = id; e.account = account; e.symbol = symbol; e.side = side; e.type = type;
    e.price = price; e.qty = qty; e.status = status; e.note = note;
    if (repo_ && !repo_->saveOrderLog(e, dropOpenOrder)) return false;      // saved first; for a cancel the order is deleted in the same step
    orderLog_.push_front(e);
    if (orderLog_.size() > 5000) orderLog_.pop_back();
    return true;
}

void TradingEngine::restoreOrderLog() {
    std::lock_guard<std::mutex> g(m_);
    if (!repo_) return;
    auto saved = repo_->loadOrderLog(5000);
    orderLog_.assign(saved.begin(), saved.end());
}

void TradingEngine::updateCandle(const Trade& t) {
    auto& dq = candles_[t.symbol];
    const std::time_t minute = t.ts / 60 * 60;
    if (!dq.empty() && dq.back().t == minute) {
        Candle& c = dq.back();
        c.h = std::max(c.h, t.price); c.l = std::min(c.l, t.price); c.c = t.price; c.v += t.qty;
    } else {
        dq.push_back(Candle{minute, t.price, t.price, t.price, t.price, t.qty});
        if (dq.size() > CANDLES_KEEP) dq.pop_front();
    }
}

// Called for every trade (bots included) while the lock is held.
void TradingEngine::recordTrade(const Trade& t) {
    last_[t.symbol] = t.price;
    Stats& s = stats_[t.symbol];
    s.high = std::max(s.high, t.price);
    s.low = std::min(s.low, t.price);
    s.volume += t.qty;
    tradesTotal_++;
    updateCandle(t);

    const bool buyerIsUser = t.buyerAcc >= FIRST_USER_ACCOUNT, sellerIsUser = t.sellerAcc >= FIRST_USER_ACCOUNT;
    Trade rec = t;
    if (buyerIsUser || sellerIsUser) {
        // Ledger: only trades with a real user are saved, so only they form the hash chain.
        rec.prevHash = lastTradeHash_;
        rec.hash = hashOf(rec, rec.prevHash);
        lastTradeHash_ = rec.hash;
        ledger_.push_back(rec);
        if (repo_) repo_->saveTrade(rec);
        if (buyerIsUser) { applyFill(accountFor(t.buyerAcc), t, true); if (t.buyRemaining == 0 && open_[t.buyerAcc].erase(t.buyOrderId) && repo_) repo_->removeOpenOrder(t.buyOrderId); }
        if (sellerIsUser) { applyFill(accountFor(t.sellerAcc), t, false); if (t.sellRemaining == 0 && open_[t.sellerAcc].erase(t.sellOrderId) && repo_) repo_->removeOpenOrder(t.sellOrderId); }
    }
    recent_.push_back(Fed{++feedSeq_, rec});
    if (recent_.size() > FEED_KEEP) recent_.pop_front();
}

// After a restart: put saved trades back into the accounts and the ledger (the saved hashes are kept as they are).
void TradingEngine::replayTrade(const Trade& t) {
    std::lock_guard<std::mutex> g(m_);
    Trade rec = t;
    if (rec.prevHash.empty() || rec.hash.empty()) { rec.prevHash = lastTradeHash_; rec.hash = hashOf(rec, rec.prevHash); }
    lastTradeHash_ = rec.hash;
    ledger_.push_back(rec);
    if (rec.buyerAcc >= FIRST_USER_ACCOUNT) applyFill(accountFor(rec.buyerAcc), rec, true);
    if (rec.sellerAcc >= FIRST_USER_ACCOUNT) applyFill(accountFor(rec.sellerAcc), rec, false);
    nextTradeId_ = std::max(nextTradeId_, rec.id + 1);
    nextOrderId_ = std::max(nextOrderId_, std::max(rec.buyOrderId, rec.sellOrderId) + 1);   // new order ids never repeat old ones
}

PlaceResult TradingEngine::submitLocked(const OrderPtr& o) {
    ScopedTimer whole(orderStats);
    OrderBook& book = *books_.at(o->symbol());
    std::vector<Trade> trades;
    {
        ScopedTimer t(matchStats);
        trades = MatchingEngine::match(book, o, nextTradeId_);
    }
    const int filled = o->quantity() - o->remaining();
    for (const Trade& t : trades) recordTrade(t);
    if (o->remaining() > 0) {
        if (o->type() == OrderType::Limit) {
            book.add(o);                                      // wait in the book (FIFO at its price)
            if (o->account() >= FIRST_USER_ACCOUNT) { open_[o->account()][o->id()] = o; if (repo_) repo_->saveOpenOrder(*o); }
        } else o->cancel();                                   // market order: the unfilled rest is cancelled
    }
    version_[o->symbol()]++;

    PlaceResult r;
    r.ok = true; r.orderId = o->id(); r.filled = filled;
    if (o->remaining() == 0) r.status = "FILLED";
    else if (o->type() == OrderType::Market) r.status = filled > 0 ? "PARTIALLY_FILLED" : "CANCELLED";
    else r.status = filled > 0 ? "PARTIALLY_FILLED" : "OPEN";

    if (o->account() >= FIRST_USER_ACCOUNT) {
        addOrderLog(o->account(), o->id(), o->symbol(), sideStr(o->side()), o->type() == OrderType::Limit ? "LIMIT" : "MARKET",
                    o->type() == OrderType::Limit ? o->price() / 100.0 : 0.0, o->quantity(), r.status,
                    r.status == "FILLED" ? "Order fully filled" : (r.status == "PARTIALLY_FILLED" ? "Order partially filled" : "Resting in order book"));
    }
    return r;
}

// Cost of buying `qty` (or what is available) by walking up the ask levels, or the proceeds of selling down the bids.
double TradingEngine::estimateMarketCost(const OrderBook& book, Side side, int qty, int& available) const {
    BookSnapshot s = book.snapshot(100000);
    const auto& levels = side == Side::Buy ? s.asks : s.bids;
    double cost = 0; int left = qty;
    for (const Level& l : levels) {
        if (left <= 0) break;
        int take = (int)std::min<long long>(left, l.qty);
        cost += take * (l.price / 100.0);
        left -= take;
    }
    available = qty - left;
    return cost;
}

// Pre-trade check. Money and shares already promised to the user's other open orders are "reserved" and cannot be used again.
// No short selling: you can only sell shares you own.
std::string TradingEngine::riskCheck(const Account& a, int account, const std::string& sym, Side side, double neededCash, int qty) const {
    double reservedCash = 0; int reservedShares = 0;
    auto it = open_.find(account);
    if (it != open_.end())
        for (const auto& kv : it->second) {
            const OrderPtr& o = kv.second;
            if (o->side() == Side::Buy) reservedCash += o->price() / 100.0 * o->remaining();
            else if (o->symbol() == sym) reservedShares += o->remaining();
        }
    if (side == Side::Buy) return a.cash() - reservedCash < neededCash - 1e-9 ? "Insufficient cash" : "";
    return a.shares(sym) - reservedShares < qty ? "Not enough shares to sell" : "";
}

PlaceResult TradingEngine::placeOrder(int account, const std::string& symbol, Side side, OrderType type, Price price, int qty) {
    std::lock_guard<std::mutex> g(m_);
    const char* sideName = side == Side::Buy ? "BUY" : "SELL";
    const char* typeName = type == OrderType::Limit ? "LIMIT" : "MARKET";
    auto reject = [&](const std::string& why) {
        addOrderLog(account, 0, symbol, sideName, typeName, price / 100.0, qty, "REJECTED", why);
        PlaceResult bad; bad.error = why; return bad;
    };
    auto bit = books_.find(symbol);
    if (bit == books_.end()) return reject("Unknown symbol");
    if (qty <= 0 || qty > 1000000) return reject("Quantity must be between 1 and 1,000,000");
    if (type == OrderType::Limit && (price <= 0 || price > 100000000)) return reject("Price must be greater than 0");

    Account& a = accountFor(account);
    double needed = 0;
    if (type == OrderType::Limit) needed = price / 100.0 * qty;
    else {
        int available = 0;
        double cost = estimateMarketCost(*bit->second, side, qty, available);
        if (available == 0) return reject(side == Side::Buy ? "No sellers available" : "No buyers available");
        needed = cost;
    }
    std::string err = riskCheck(a, account, symbol, side, side == Side::Buy ? needed : 0, qty);
    if (!err.empty()) return reject(err);

    OrderPtr o;
    if (type == OrderType::Limit) o = std::make_shared<LimitOrder>(nextOrderId_++, account, symbol, side, price, qty);
    else o = std::make_shared<MarketOrder>(nextOrderId_++, account, symbol, side, qty);
    return submitLocked(o);
}

bool TradingEngine::cancelOrder(long id, int account, std::string& error) {
    std::lock_guard<std::mutex> g(m_);
    for (auto& kv : books_) {
        OrderPtr o = kv.second->find(id);
        if (!o) continue;
        if (o->account() != account) { error = "Not your order"; return false; }
        const int left = o->remaining();
        // Save first: the history line and the deletion of the resting order are committed together. If that fails the order stays
        // exactly as it was; if the program crashes, the order is either still fully alive or fully cancelled.
        if (!addOrderLog(account, id, o->symbol(), sideStr(o->side()), o->type() == OrderType::Limit ? "LIMIT" : "MARKET",
                         o->price() / 100.0, left, "CANCELLED", "Order cancelled by user", id)) { error = "Could not save the cancel, try again"; return false; }
        kv.second->cancel(id);
        open_[account].erase(id);
        version_[kv.first]++;
        return true;
    }
    error = "Order not found";
    return false;
}

void TradingEngine::placeBotOrder(int botId, const std::string& symbol, Side side, Price price, int qty) {
    std::lock_guard<std::mutex> g(m_);
    auto it = books_.find(symbol);
    if (it == books_.end() || price <= 0 || qty <= 0) return;
    if (it->second->size() >= MAX_RESTING_ORDERS) return;
    submitLocked(std::make_shared<LimitOrder>(nextOrderId_++, botId, symbol, side, price, qty));
}

// Bots re-quote: resting bot orders that drifted too far from the reference price are cancelled.
int TradingEngine::cancelStaleBotOrders(const std::string& symbol, Price lo, Price hi) {
    std::lock_guard<std::mutex> g(m_);
    auto it = books_.find(symbol);
    if (it == books_.end()) return 0;
    std::vector<long> ids;
    it->second->forEach([&](const OrderPtr& o) {
        if (o->account() < FIRST_USER_ACCOUNT && (o->price() < lo || o->price() > hi)) ids.push_back(o->id());
    });
    for (long id : ids) it->second->cancel(id);
    if (!ids.empty()) version_[symbol]++;
    return (int)ids.size();
}

// After a restart, once the trades are replayed: the saved resting orders go back into the books. How much of each is already
// filled is the saved quantity minus the quantity of its saved trades (an order that is completely filled is dropped).
int TradingEngine::restoreOpenOrders() {
    std::lock_guard<std::mutex> g(m_);
    if (!repo_) return 0;
    std::unordered_map<long, int> filled;
    for (const Trade& t : ledger_) { filled[t.buyOrderId] += t.qty; filled[t.sellOrderId] += t.qty; }
    int restored = 0;
    for (const SavedOrder& s : repo_->loadOpenOrders()) {
        auto bit = books_.find(s.symbol);
        const int left = s.qty - filled[s.id];
        if (bit == books_.end() || left <= 0) { repo_->removeOpenOrder(s.id); continue; }
        auto o = std::make_shared<LimitOrder>(s.id, s.account, s.symbol, s.side, (Price)s.price, s.qty);
        if (left < s.qty) o->fill(s.qty - left);
        accountFor(s.account);
        bit->second->add(o);
        open_[s.account][s.id] = o;
        version_[s.symbol]++;
        nextOrderId_ = std::max(nextOrderId_, s.id + 1);
        restored++;
    }
    return restored;
}

// Start-up liquidity: random resting bot orders, buys below and sells above the base price (so nothing trades while loading).
// The generator has a fixed seed, so every run starts with the same books.
int TradingEngine::seedBook(int totalOrders) {
    std::lock_guard<std::mutex> g(m_);
    std::mt19937 rng(42);
    std::uniform_real_distribution<double> off(0.001, 0.03), u(0, 1);
    std::uniform_int_distribution<int> qty(10, 500), bot(1, 1000), sym(0, (int)symbols().size() - 1);
    for (int i = 0; i < totalOrders; i++) {
        const std::string& s = symbols()[sym(rng)];
        const double base = (double)basePrice(s);
        const bool buy = u(rng) < 0.5;
        const Price p = (Price)std::llround(base * (buy ? 1 - off(rng) : 1 + off(rng)));
        submitLocked(std::make_shared<LimitOrder>(nextOrderId_++, bot(rng), s, buy ? Side::Buy : Side::Sell, p, qty(rng)));
    }
    return totalOrders;
}

BookSnapshot TradingEngine::snapshot(const std::string& symbol, int depth) const {
    std::lock_guard<std::mutex> g(m_);
    auto it = books_.find(symbol);
    if (it == books_.end()) return BookSnapshot{};
    BookSnapshot s = it->second->snapshot(depth);
    s.last = last_.at(symbol);
    return s;
}

std::vector<Quote> TradingEngine::quotes() const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<Quote> out;
    for (const auto& s : symbols()) {
        const Stats& st = stats_.at(s);
        Quote q;
        q.symbol = s; q.name = companyName(s);
        q.last = last_.at(s) / 100.0; q.open = st.open / 100.0; q.high = st.high / 100.0; q.low = st.low / 100.0;
        q.prevClose = st.prevClose / 100.0; q.change = q.last - q.prevClose;
        q.changePct = q.prevClose > 0 ? q.change / q.prevClose * 100.0 : 0;
        q.volume = st.volume;
        out.push_back(q);
    }
    return out;
}

std::vector<OrderInfo> TradingEngine::openOrders(int account) const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<OrderInfo> out;
    auto it = open_.find(account);
    if (it == open_.end()) return out;
    for (const auto& kv : it->second) {                      // the map is sorted by order id
        const OrderPtr& o = kv.second;
        out.push_back({o->id(), o->symbol(), o->side(), o->price(), o->quantity(), o->remaining()});
    }
    return out;
}

std::vector<Trade> TradingEngine::userTrades(int account, const std::string& symbol, int sideFilter, size_t limit) const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<Trade> out;
    for (auto it = ledger_.rbegin(); it != ledger_.rend() && out.size() < limit; ++it) {
        const bool buyer = it->buyerAcc == account;
        if (!buyer && it->sellerAcc != account) continue;
        if (!symbol.empty() && it->symbol != symbol) continue;
        if (sideFilter == 0 && !buyer) continue;
        if (sideFilter == 1 && buyer) continue;
        out.push_back(*it);
    }
    return out;
}

std::vector<ReceiptView> TradingEngine::receipts(int account, size_t limit) const {
    std::vector<ReceiptView> out;
    for (const Trade& t : userTrades(account, "", -1, limit)) {
        ReceiptView r;
        char num[48];
        std::tm tmv{};
        std::time_t ts = t.ts;
#ifdef _WIN32
        localtime_s(&tmv, &ts);
#else
        localtime_r(&ts, &tmv);
#endif
        std::snprintf(num, sizeof num, "TX-%04d-%07ld", tmv.tm_year + 1900, t.id);
        r.number = num; r.tradeId = t.id; r.ts = t.ts; r.symbol = t.symbol;
        r.side = t.buyerAcc == account ? Side::Buy : Side::Sell;
        r.orderId = t.buyerAcc == account ? t.buyOrderId : t.sellOrderId;
        r.qty = t.qty; r.price = t.price / 100.0; r.total = r.price * t.qty;
        out.push_back(r);
    }
    return out;
}

std::vector<OrderLogEntry> TradingEngine::userOrderLog(int account, size_t limit) const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<OrderLogEntry> out;
    for (const auto& e : orderLog_) {
        if (e.account != account) continue;
        out.push_back(e);
        if (out.size() >= limit) break;
    }
    return out;
}

VerifyResult TradingEngine::verifyLedger() const {
    std::lock_guard<std::mutex> g(m_);                       // saving also happens under this lock, so the file is never half written
    if (repo_) return verifyChain(repo_->loadTrades());      // check what is really on disk
    return verifyChain(ledger_);
}

// Real 1-minute candles built from the trades since the server started. Minutes without a trade are flat at the previous close.
std::string TradingEngine::candlesJson(const std::string& sym, int count) const {
    std::lock_guard<std::mutex> g(m_);
    if (!books_.count(sym)) return "[]";
    static const std::deque<Candle> none;
    auto it = candles_.find(sym);
    const std::deque<Candle>& dq = it == candles_.end() ? none : it->second;
    const std::time_t nowMin = std::time(nullptr) / 60 * 60;
    const std::time_t start = nowMin - (std::time_t)(count - 1) * 60;
    Price prev = basePrice(sym);
    size_t i = 0;
    while (i < dq.size() && dq[i].t < start) prev = dq[i++].c;
    std::string out = "[";
    for (int k = 0; k < count; k++) {
        const std::time_t m = start + (std::time_t)k * 60;
        Candle c{m, prev, prev, prev, prev, 0};
        if (i < dq.size() && dq[i].t == m) { c = dq[i++]; prev = c.c; }
        char bar[160];
        std::snprintf(bar, sizeof bar, "%s{\"t\":%lld,\"o\":%.2f,\"h\":%.2f,\"l\":%.2f,\"c\":%.2f,\"v\":%lld}", k ? "," : "",
                      (long long)c.t, c.o / 100.0, c.h / 100.0, c.l / 100.0, c.c / 100.0, c.v);
        out += bar;
    }
    return out + "]";
}

PortfolioView TradingEngine::portfolio(int account) {
    std::lock_guard<std::mutex> g(m_);
    Account& a = accountFor(account);
    PortfolioView v;
    v.cash = a.cash();
    v.value = valueOf(a);
    v.pnlToday = v.value - a.startValue();
    for (const auto& kv : a.holdings())
        if (kv.second.qty > 0) v.holdings.push_back({kv.first, kv.second.qty, kv.second.avgCost, last_.at(kv.first) / 100.0});
    const auto& s = a.series();
    const size_t step = std::max<size_t>(1, s.size() / 200);
    for (size_t i = 0; i < s.size(); i += step) v.series.push_back(s[i]);
    v.series.emplace_back(std::time(nullptr), v.value);
    return v;
}

size_t TradingEngine::openOrderCount() const {
    std::lock_guard<std::mutex> g(m_);
    size_t n = 0;
    for (const auto& kv : books_) n += kv.second->size();
    return n;
}

long TradingEngine::feedSeq() const { std::lock_guard<std::mutex> g(m_); return feedSeq_; }

std::vector<Trade> TradingEngine::tradesSince(const std::string& sym, long& seq) const {
    std::lock_guard<std::mutex> g(m_);
    std::vector<Trade> out;
    for (const Fed& f : recent_)
        if (f.seq > seq && f.trade.symbol == sym) out.push_back(f.trade);
    seq = feedSeq_;
    return out;
}

long TradingEngine::bookVersion(const std::string& sym) const {
    std::lock_guard<std::mutex> g(m_);
    auto it = version_.find(sym);
    return it == version_.end() ? 0 : it->second;
}

}  // namespace tx
