#pragma once
// A real, measured benchmark (nothing here is estimated). Shown on the Performance page and printed by `make bench`.
// RAM vs disk: the same orders, once with everything in memory and once with a committed database write for every user trade.
#include <mutex>

namespace tx {

struct BenchResult {
    bool ready = false;
    int diskOrders = 0;        // orders used in the test
    double ramUs = 0;          // microseconds per order, matching in RAM only
    double diskUs = 0;         // microseconds per order, with a database write (committed to disk) for every trade
    long long diskTrades = 0;  // trades written during the disk test
};

BenchResult runBenchmark(int seedOrders = 20000, int orders = 1500);

// Holds the newest result so the HTTP thread can read it while a background thread produces it.
class BenchState {
public:
    void set(const BenchResult& r) { std::lock_guard<std::mutex> g(m_); r_ = r; }
    BenchResult get() const { std::lock_guard<std::mutex> g(m_); return r_; }
private:
    mutable std::mutex m_;
    BenchResult r_;
};

}  // namespace tx
