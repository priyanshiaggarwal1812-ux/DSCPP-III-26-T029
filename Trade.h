#pragma once
#include <ctime>
#include <string>
#include "common/Types.h"
extern "C" {
#include "sha256.h"
}

namespace tx {

inline const std::string GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

struct Trade {
    long id = 0;
    std::time_t ts = 0;
    std::string symbol;
    Price price = 0;                 // cents, always the price of the resting order
    int qty = 0;
    Side aggressor = Side::Buy;      // side of the order that arrived and caused the trade
    int buyerAcc = 0, sellerAcc = 0;
    long buyOrderId = 0, sellOrderId = 0;
    int buyRemaining = 0, sellRemaining = 0;   // what is left of each order after this trade
    std::string prevHash;            // SHA-256 hash of previous trade in ledger
    std::string hash;                // SHA-256 hash of this trade record
};

inline std::string computeTradeHash(const std::string& prevHash, long id, std::time_t ts, const std::string& symbol,
                                    Price price, int qty, Side aggressor, int buyerAcc, int sellerAcc,
                                    long buyOrderId, long sellOrderId) {
    std::string payload = prevHash + "|" + std::to_string(id) + "|" + std::to_string((long long)ts) + "|" +
                          symbol + "|" + std::to_string(price) + "|" + std::to_string(qty) + "|" +
                          (aggressor == Side::Buy ? "B" : "S") + "|" + std::to_string(buyerAcc) + "|" +
                          std::to_string(sellerAcc) + "|" + std::to_string(buyOrderId) + "|" + std::to_string(sellOrderId);
    char hex[65];
    sha256_hex((const unsigned char*)payload.data(), payload.size(), hex);
    return std::string(hex);
}

}  // namespace tx
