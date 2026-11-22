#pragma once
#include <ctime>
#include <memory>
#include <string>
#include <utility>
#include "common/Types.h"

namespace tx {

// Base class of every order. Human and bot orders are the same kind of object.
// Encapsulation: the remaining quantity is private and can only change through fill().
class Order {
public:
    Order(long id, int account, std::string symbol, Side side, Price price, int qty)
        : id_(id), account_(account), symbol_(std::move(symbol)), side_(side), price_(price),
          qty_(qty), remaining_(qty), ts_(std::time(nullptr)) {}
    virtual ~Order() = default;

    virtual OrderType type() const = 0;
    // Polymorphism: can this order trade against the best opposite price?
    virtual bool acceptsPrice(Price opposite) const = 0;

    long id() const { return id_; }
    int account() const { return account_; }
    const std::string& symbol() const { return symbol_; }
    Side side() const { return side_; }
    Price price() const { return price_; }
    int quantity() const { return qty_; }
    int remaining() const { return remaining_; }
    Status status() const { return status_; }
    std::time_t timestamp() const { return ts_; }

    void fill(int q) { remaining_ -= q; status_ = remaining_ <= 0 ? Status::Filled : Status::PartiallyFilled; }
    void cancel() { status_ = Status::Cancelled; }

private:
    long id_;
    int account_;
    std::string symbol_;
    Side side_;
    Price price_;
    int qty_;
    int remaining_;
    Status status_ = Status::Open;
    std::time_t ts_;
};

// Trades at its limit price or better.
class LimitOrder : public Order {
public:
    using Order::Order;
    OrderType type() const override { return OrderType::Limit; }
    bool acceptsPrice(Price opposite) const override {
        return side() == Side::Buy ? opposite <= price() : opposite >= price();
    }
};

// Trades at any price until filled or the book runs out. The unfilled rest is cancelled.
class MarketOrder : public Order {
public:
    MarketOrder(long id, int account, std::string symbol, Side side, int qty)
        : Order(id, account, std::move(symbol), side, 0, qty) {}
    OrderType type() const override { return OrderType::Market; }
    bool acceptsPrice(Price) const override { return true; }
};

using OrderPtr = std::shared_ptr<Order>;

}  // namespace tx
