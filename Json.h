#pragma once
// JSON helpers on top of nlohmann/json (third_party/nlohmann/json.hpp).
#include <cstdlib>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>
#include "common/Types.h"
#include "domain/Trade.h"

namespace tx {

using json = nlohmann::json;

// Text of a JSON value. User-supplied text can contain bytes that are not valid UTF-8; "replace" keeps dump() from throwing.
inline std::string dump(const json& j) { return j.dump(-1, ' ', false, json::error_handler_t::replace); }

// Reads a string field from a request body. False when the key is missing or not a string.
inline bool getString(const json& body, const char* key, std::string& out) {
    if (!body.is_object() || !body.contains(key) || !body[key].is_string()) return false;
    out = body[key].get<std::string>();
    return true;
}
// Reads a number field (a JSON number, or a string that holds one).
inline bool getNumber(const json& body, const char* key, double& out) {
    if (!body.is_object() || !body.contains(key)) return false;
    const json& v = body[key];
    if (v.is_number()) { out = v.get<double>(); return true; }
    if (v.is_string()) {
        const std::string s = v.get<std::string>();
        char* end = nullptr;
        double d = std::strtod(s.c_str(), &end);
        if (!s.empty() && *end == '\0') { out = d; return true; }
    }
    return false;
}

inline json levelsJson(const std::vector<Level>& v) {
    json a = json::array();
    for (const Level& l : v) a.push_back(json::array({l.price / 100.0, l.qty}));     // [[price, qty], ...]
    return a;
}
// type is "snapshot" or "book" for stream events, or nullptr for the plain REST answer
inline json bookJson(const char* type, const BookSnapshot& s) {
    json j;
    if (type) j["type"] = type;
    j["symbol"] = s.symbol; j["bids"] = levelsJson(s.bids); j["asks"] = levelsJson(s.asks); j["last"] = s.last / 100.0;
    return j;
}
inline json tradeEvent(const Trade& t, bool mine) {
    return {{"type", "trade"}, {"symbol", t.symbol}, {"price", t.price / 100.0}, {"qty", t.qty},
            {"side", sideStr(t.aggressor)}, {"ts", (long long)t.ts}, {"mine", mine}};
}
inline json fillEvent(long orderId, int remaining) {
    return {{"type", "fill"}, {"order_id", orderId}, {"remaining", remaining}};
}

}  // namespace tx
