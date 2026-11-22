#pragma once
#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <vector>
#ifdef _WIN32
  #define NOMINMAX
  #include <windows.h>
  #include <psapi.h>          // link with -lpsapi
#else
  #include <unistd.h>
#endif

using Clock = std::chrono::steady_clock;

// Keeps the last CAP latency samples and reports average and percentiles.
class LatencyStats {
public:
    struct Snapshot { size_t samples; double avg_us, p50_us, p95_us, p99_us, max_us, per_sec; };

    void record(std::chrono::nanoseconds d) {
        std::lock_guard<std::mutex> g(m_);
        if (buf_.size() < CAP) buf_.push_back(d.count());
        else buf_[next_++ % CAP] = d.count();
        if (total_ == 0) start_ = Clock::now();
        ++total_;
    }
    void reset() { std::lock_guard<std::mutex> g(m_); buf_.clear(); next_ = 0; total_ = 0; }
    size_t total() const { std::lock_guard<std::mutex> g(m_); return total_; }
    Snapshot snapshot() const {
        std::vector<int64_t> v;
        size_t total; Clock::time_point start;
        { std::lock_guard<std::mutex> g(m_); v = buf_; total = total_; start = start_; }
        Snapshot s{v.size(), 0, 0, 0, 0, 0, 0};
        if (v.empty()) return s;
        std::sort(v.begin(), v.end());
        auto pct = [&](double p) { return v[std::min(v.size() - 1, (size_t)(p * v.size()))] / 1000.0; };
        double sum = 0; for (auto x : v) sum += x;
        s.avg_us = sum / v.size() / 1000.0;
        s.p50_us = pct(0.50); s.p95_us = pct(0.95); s.p99_us = pct(0.99);
        s.max_us = v.back() / 1000.0;
        double secs = std::chrono::duration<double>(Clock::now() - start).count();
        s.per_sec = secs > 0 ? total / secs : 0;
        return s;
    }
private:
    static constexpr size_t CAP = 100000;
    mutable std::mutex m_;
    std::vector<int64_t> buf_;
    size_t next_ = 0, total_ = 0;
    Clock::time_point start_;
};

// RAII timer: measures from construction to the end of the scope.
class ScopedTimer {
public:
    explicit ScopedTimer(LatencyStats& s) : s_(s), t0_(Clock::now()) {}
    ~ScopedTimer() { s_.record(Clock::now() - t0_); }
private:
    LatencyStats& s_;
    Clock::time_point t0_;
};

// RAM used by this process right now (resident set), in bytes.
inline size_t residentBytes() {
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc))) return pmc.WorkingSetSize;
    return 0;
#else
    std::ifstream f("/proc/self/statm");
    size_t total = 0, rss = 0;
    f >> total >> rss;
    return rss * (size_t)sysconf(_SC_PAGESIZE);
#endif
}
