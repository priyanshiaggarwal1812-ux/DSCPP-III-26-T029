// Tests for the C data structures. The C sorted list and hash table are compared with std::map / std::unordered_map.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <random>
#include <string>
#include <unordered_map>
extern "C" {
#include "dlist.h"
#include "hashtable.h"
#include "sorted_list.h"
#include "sha256.h"
}
static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); failures++; } } while (0)

static void test_dlist() {
    DList *l = dlist_create();
    int a = 1, b = 2, c = 3;
    DNode *na = dlist_push_back(l, &a); DNode *nb = dlist_push_back(l, &b); dlist_push_back(l, &c);
    CHECK(dlist_size(l) == 3 && dlist_front(l) == &a);
    dlist_remove(l, nb);                                   // remove from the middle
    CHECK(dlist_size(l) == 2 && na->next->data == &c);
    CHECK(dlist_pop_front(l) == &a);                       // FIFO order
    CHECK(dlist_pop_front(l) == &c);
    CHECK(dlist_pop_front(l) == nullptr && dlist_size(l) == 0);
    dlist_destroy(l);
}

static void test_hash() {
    std::mt19937 rng(7);
    HashTable *hi = ht_create_int(16), *hs = ht_create_str(16);
    std::unordered_map<long, long> ri; std::unordered_map<std::string, long> rs;
    for (int i = 0; i < 200000; i++) {
        long k = (long)(rng() % 5000); std::string sk = "user" + std::to_string(rng() % 5000);
        int op = rng() % 3;
        if (op == 0) { ht_put_int(hi, k, (void*)(uintptr_t)(k + 1)); ri[k] = k + 1; ht_put_str(hs, sk.c_str(), (void*)(uintptr_t)(k + 1)); rs[sk] = k + 1; }
        else if (op == 1) {
            void *v = ht_get_int(hi, k); CHECK((long)(uintptr_t)v == (ri.count(k) ? ri[k] : 0));
            v = ht_get_str(hs, sk.c_str()); CHECK((long)(uintptr_t)v == (rs.count(sk) ? rs[sk] : 0));
        } else {
            void *v = ht_remove_int(hi, k); CHECK((long)(uintptr_t)v == (ri.count(k) ? ri[k] : 0)); ri.erase(k);
            v = ht_remove_str(hs, sk.c_str()); CHECK((long)(uintptr_t)v == (rs.count(sk) ? rs[sk] : 0)); rs.erase(sk);
        }
    }
    CHECK(ht_size(hi) == ri.size() && ht_size(hs) == rs.size());
    ht_destroy(hi, nullptr); ht_destroy(hs, nullptr);
}

static void test_sorted_list() {
    std::mt19937 rng(13);
    SortedList *l = slist_create();
    std::map<long long, long> ref;
    for (int i = 0; i < 50000; i++) {
        long long k = (long long)(rng() % 1500);
        int op = rng() % 3;
        if (op < 2) { slist_insert(l, k, (void*)(uintptr_t)(k + 1)); ref[k] = k + 1; }
        else { void *v = slist_erase(l, k); CHECK((long)(uintptr_t)v == (ref.count(k) ? ref[k] : 0)); ref.erase(k); }
        if (i % 5000 == 0) CHECK(slist_check(l) == 1);
    }
    CHECK(slist_check(l) == 1 && slist_size(l) == ref.size());
    long long key;
    if (!ref.empty()) {
        CHECK(slist_min(l, &key) && key == ref.begin()->first);
        CHECK(slist_max(l, &key) && key == ref.rbegin()->first);
        auto it = ref.begin(); long long k;
        void *v = slist_min(l, &k);
        while (v) { CHECK(it != ref.end() && it->first == k); ++it; v = slist_next(l, k, &k); }
        CHECK(it == ref.end());
        auto rit = ref.rbegin(); v = slist_max(l, &k);
        while (v) { CHECK(rit != ref.rend() && rit->first == k); ++rit; v = slist_prev(l, k, &k); }
        CHECK(rit == ref.rend());
    }
    for (auto &kv : ref) CHECK(slist_find(l, kv.first) == (void*)(uintptr_t)kv.second);
    slist_destroy(l, nullptr);
}

static void test_sha() {
    char out[65];
    sha256_hex((const unsigned char*)"", 0, out);
    CHECK(std::strcmp(out, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") == 0);
    sha256_hex((const unsigned char*)"abc", 3, out);
    CHECK(std::strcmp(out, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);
    std::string long_msg(1000, 'a');                       // crosses several 64-byte blocks
    sha256_hex((const unsigned char*)long_msg.data(), long_msg.size(), out);
    CHECK(std::strcmp(out, "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3") == 0);
}

int main() {
    test_dlist(); test_hash(); test_sorted_list(); test_sha();
    std::printf(failures ? "C data structure tests: %d FAILED\n" : "C data structure tests: all passed\n", failures);
    return failures ? 1 : 0;
}
