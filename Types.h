#pragma once
#include <cmath>
#include <cstdio>
#include <ctime>
#include <string>
#include <vector>

namespace tx {

using Price = long long;   // price in CENTS. Floating point is never used as a key in the sorted list or hash table.

enum class Side { Buy, Sell };
enum class OrderType { Limit, Market };
enum class Status { Open, PartiallyFilled, Filled, Cancelled };

constexpr int FIRST_USER_ACCOUNT = 1001;   // account numbers below this belong to bots

inline const char* sideStr(Side s) { return s == Side::Buy ? "BUY" : "SELL"; }
inline const char* statusStr(Status s) {
    switch (s) {
        case Status::Open: return "OPEN";
        case Status::PartiallyFilled: return "PARTIALLY_FILLED";
        case Status::Filled: return "FILLED";
        default: return "CANCELLED";
    }
}
inline Price toCents(double dollars) { return (Price)std::llround(dollars * 100.0); }
inline std::string centsStr(Price c) {                      // 15150 -> "151.50"
    char b[48];
    std::snprintf(b, sizeof b, "%lld.%02lld", c / 100, c % 100);
    return b;
}

struct Level { Price price; long long qty; };               // one price level of the book
struct BookSnapshot { std::string symbol; std::vector<Level> bids, asks; Price last = 0; };

}  // namespace tx
