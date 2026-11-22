#pragma once
// SHA-256 hash chain over the saved trades (the project's "innovation").
// Every saved trade stores prev_hash (hash of the trade before it) and its own hash.
// Changing any old trade changes its hash, so the next trade's prev_hash no longer matches: the chain breaks.
#include <string>
#include <vector>
#include "domain/Trade.h"

namespace tx {

struct VerifyResult {
    bool valid = true;
    size_t count = 0;
    long brokenAtId = 0;
    std::string lastHash = GENESIS_HASH;
    std::string error;
};

inline std::string hashOf(const Trade& t, const std::string& prev) {
    return computeTradeHash(prev, t.id, t.ts, t.symbol, t.price, t.qty, t.aggressor,
                            t.buyerAcc, t.sellerAcc, t.buyOrderId, t.sellOrderId);
}

// Walks the trades in order, recomputes every hash and checks every prev_hash link.
inline VerifyResult verifyChain(const std::vector<Trade>& trades) {
    VerifyResult r;
    r.count = trades.size();
    std::string expectedPrev = GENESIS_HASH;
    for (const Trade& t : trades) {
        if (t.prevHash != expectedPrev) {
            r.valid = false; r.brokenAtId = t.id;
            r.error = "prev_hash does not match the previous trade (trade #" + std::to_string(t.id) + ")";
            return r;
        }
        if (t.hash != hashOf(t, t.prevHash)) {
            r.valid = false; r.brokenAtId = t.id;
            r.error = "trade data was changed after it was saved (trade #" + std::to_string(t.id) + ")";
            return r;
        }
        expectedPrev = t.hash;
    }
    r.lastHash = expectedPrev;
    return r;
}

}  // namespace tx
