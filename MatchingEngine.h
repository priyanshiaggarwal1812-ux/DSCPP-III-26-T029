#pragma once
#include <algorithm>
#include <vector>
#include "book/OrderBook.h"
#include "domain/Trade.h"

namespace tx {

// Price-Time Priority matching.
//   Price priority: the best price on the opposite side trades first (best level of the sorted price list).
//   Time priority:  at the same price the oldest order trades first (front of the FIFO list).
// A trade happens while the incoming order accepts the best opposite price. The trade price is the resting order's price.
class MatchingEngine {
public:
    // Matches `in` against `book`. Does not rest the leftover; the caller decides what to do with it.
    static std::vector<Trade> match(OrderBook& book, const OrderPtr& in, long& nextTradeId) {
        std::vector<Trade> trades;
        const Side opposite = in->side() == Side::Buy ? Side::Sell : Side::Buy;
        while (in->remaining() > 0) {
            Price px;
            if (!book.bestPrice(opposite, px)) break;            // nothing left to trade against
            if (!in->acceptsPrice(px)) break;                    // best price is not good enough
            OrderPtr resting = book.best(opposite);
            const int q = std::min(in->remaining(), resting->remaining());

            Trade t;
            t.id = nextTradeId++;
            t.ts = std::time(nullptr);
            t.symbol = in->symbol();
            t.price = px;
            t.qty = q;
            t.aggressor = in->side();
            const bool inBuys = in->side() == Side::Buy;
            t.buyerAcc = inBuys ? in->account() : resting->account();
            t.sellerAcc = inBuys ? resting->account() : in->account();
            t.buyOrderId = inBuys ? in->id() : resting->id();
            t.sellOrderId = inBuys ? resting->id() : in->id();

            in->fill(q);
            book.applyFill(resting, q);                          // removes the resting order if it is done
            t.buyRemaining = inBuys ? in->remaining() : resting->remaining();
            t.sellRemaining = inBuys ? resting->remaining() : in->remaining();
            trades.push_back(t);
        }
        return trades;
    }
};

}  // namespace tx
