#pragma once
// C++ RAII wrappers around the C data structures in c_ds/.
// The C code only stores plain pointers. These classes own the memory and free it in their destructors.
#include <cstddef>
#include <memory>
#include <new>
#include "common/Types.h"
#include "domain/Order.h"
#include "dlist.h"
#include "hashtable.h"
#include "sorted_list.h"

namespace tx {

// FIFO queue of orders at one price (wraps the C doubly linked list).
class OrderQueue {
public:
    OrderQueue() : l_(dlist_create()) { if (!l_) throw std::bad_alloc(); }
    ~OrderQueue() { dlist_destroy(l_); }
    OrderQueue(const OrderQueue&) = delete;
    OrderQueue& operator=(const OrderQueue&) = delete;
    DNode* push(void* data) { DNode* n = dlist_push_back(l_, data); if (!n) throw std::bad_alloc(); return n; }
    void remove(DNode* n) { dlist_remove(l_, n); }          // O(1) because we hold the node
    void* front() const { return dlist_front(l_); }
    size_t size() const { return dlist_size(l_); }
    const DNode* head() const { return l_->head; }
private:
    DList* l_;
};

struct PriceLevel {
    OrderQueue queue;
    long long totalQty = 0;
};

// What the order index stores: the order plus where it sits, so cancel needs no searching.
struct OrderRef {
    OrderPtr order;
    DNode* node = nullptr;
    PriceLevel* level = nullptr;
};

// Sorted price levels of ONE side of the book, using the C sorted doubly linked list.
// Keys are prices in cents. best(highest=true) is the best bid (highest price), best(false) the best ask (lowest price).
// Finding a price walks the list, so insert and find are O(n) in the number of price levels (a few hundred here).
class PriceLevels {
public:
    PriceLevels() : l_(slist_create()) { if (!l_) throw std::bad_alloc(); }
    ~PriceLevels() { slist_destroy(l_, [](void* p) { delete static_cast<PriceLevel*>(p); }); }
    PriceLevels(const PriceLevels&) = delete;
    PriceLevels& operator=(const PriceLevels&) = delete;

    PriceLevel* find(Price p) const { return static_cast<PriceLevel*>(slist_find(l_, p)); }
    PriceLevel* getOrCreate(Price p) {
        if (PriceLevel* lv = find(p)) return lv;
        PriceLevel* lv = new PriceLevel;
        if (slist_insert(l_, p, lv) < 0) { delete lv; throw std::bad_alloc(); }
        return lv;
    }
    void erase(Price p) { delete static_cast<PriceLevel*>(slist_erase(l_, p)); }
    PriceLevel* best(bool highest, Price* out) const {
        long long k = 0;
        void* v = highest ? slist_max(l_, &k) : slist_min(l_, &k);
        if (out) *out = (Price)k;
        return static_cast<PriceLevel*>(v);
    }
    // next level after price p, moving away from the best price (down for bids, up for asks)
    PriceLevel* after(Price p, bool highest, Price* out) const {
        long long k = 0;
        void* v = highest ? slist_prev(l_, p, &k) : slist_next(l_, p, &k);
        if (out) *out = (Price)k;
        return static_cast<PriceLevel*>(v);
    }
    size_t size() const { return slist_size(l_); }
private:
    SortedList* l_;
};

// Order ID -> OrderRef (wraps the C hash table with integer keys).
class OrderIndex {
public:
    OrderIndex() : h_(ht_create_int(4096)) { if (!h_) throw std::bad_alloc(); }
    ~OrderIndex() { ht_destroy(h_, [](void* p) { delete static_cast<OrderRef*>(p); }); }
    OrderIndex(const OrderIndex&) = delete;
    OrderIndex& operator=(const OrderIndex&) = delete;
    void put(long id, OrderRef* r) { if (ht_put_int(h_, id, r) < 0) throw std::bad_alloc(); }
    OrderRef* get(long id) const { return static_cast<OrderRef*>(ht_get_int(h_, id)); }
    OrderRef* remove(long id) { return static_cast<OrderRef*>(ht_remove_int(h_, id)); }
    size_t size() const { return ht_size(h_); }
private:
    HashTable* h_;
};

}  // namespace tx
