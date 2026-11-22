#pragma once
#include <ctime>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace tx {

struct Holding { int qty = 0; double avgCost = 0; };   // avgCost in dollars

// Simulated cash and share balances of one user. Data is private; only the engine changes it through these methods.
class Account {
public:
    explicit Account(int id = 0) : id_(id) {}
    int id() const { return id_; }
    double cash() const { return cash_; }
    int shares(const std::string& sym) const { auto it = hold_.find(sym); return it == hold_.end() ? 0 : it->second.qty; }
    const std::map<std::string, Holding>& holdings() const { return hold_; }

    void grantShares(const std::string& sym, int qty, double avg) { hold_[sym] = Holding{qty, avg}; }

    void applyBuy(const std::string& sym, int qty, double price) {
        Holding& h = hold_[sym];
        h.avgCost = (h.avgCost * h.qty + price * qty) / (h.qty + qty);
        h.qty += qty;
        cash_ -= price * qty;
    }
    void applySell(const std::string& sym, int qty, double price) {
        Holding& h = hold_[sym];
        h.qty -= qty;
        if (h.qty <= 0) { h.qty = 0; h.avgCost = 0; }
        cash_ += price * qty;
    }

    void setStartValue(double v) { startValue_ = v; }
    double startValue() const { return startValue_; }
    void record(std::time_t ts, double value) {
        series_.emplace_back(ts, value);
        if (series_.size() > 2000) series_.erase(series_.begin(), series_.begin() + 500);
    }
    const std::vector<std::pair<std::time_t, double>>& series() const { return series_; }

private:
    int id_;
    double cash_ = 100000.0;
    double startValue_ = 0;
    std::map<std::string, Holding> hold_;
    std::vector<std::pair<std::time_t, double>> series_;
};

}  // namespace tx
