// Tests for users, sessions, persistence, bots and the price sources.
#include <cstdio>
#include <filesystem>
#include <fstream>
#include "domain/Ledger.h"
#include <thread>
#include "auth/UserManager.h"
#include "bots/Bots.h"
#include <sqlite3.h>
#include "persistence/Repository.h"
using namespace tx;
static int failures = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL line %d: %s\n", __LINE__, #c); failures++; } } while (0)

static void test_users() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_users").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    std::string file = dir + "/tradex.db", err; int acc = 0, acc2 = 0;
    {
        Database db1(file);
        UserManager u(db1);
        CHECK(!u.registerUser("ab", "password1", err, acc) && !err.empty());                 // too short
        CHECK(!u.registerUser("alice", "short", err, acc));                                  // weak password
        CHECK(u.registerUser("alice", "password1", err, acc) && acc == 1001);
        CHECK(!u.registerUser("alice", "password1", err, acc2) && err == "Username already taken");
        CHECK(u.registerUser("bob", "password2", err, acc2) && acc2 == 1002);
        CHECK(u.login("alice", "password1", err, acc) && acc == 1001);
        CHECK(!u.login("alice", "wrongpass1", err, acc) && err == "Invalid username or password");
        CHECK(!u.login("nobody", "password1", err, acc));
        CHECK(!u.changePassword("alice", "bad", "newpassw0rd", err));
        CHECK(u.changePassword("alice", "password1", "newpassw0rd", err));
    }
    Database db2(file);
    UserManager again(db2);                                                                   // restart: reload from the database file
    CHECK(again.login("alice", "newpassw0rd", err, acc) && acc == 1001);                      // newest password wins
    CHECK(!again.login("alice", "password1", err, acc));
    CHECK(again.login("bob", "password2", err, acc) && acc == 1002);
    CHECK(UserManager::accountLabel(1001) == "ACC-001001");
    std::string t1, t2;
    SessionManager::Session x;
    {
        SessionManager s(db2); t1 = s.create(1001, "alice"); t2 = s.create(1002, "bob");
        CHECK(t1 != t2 && t1.size() == 32 && s.get(t1, x) && x.account == 1001 && x.username == "alice");
        CHECK(!s.get("nope", x));
    }
    SessionManager restarted(db2);                                                            // restart: the same tokens still work
    CHECK(restarted.get(t1, x) && x.account == 1001 && x.username == "alice" && restarted.get(t2, x) && x.account == 1002);
    db2.run("SELECT token_hash FROM sessions", {}, [&](sqlite3_stmt* r) { CHECK(Database::text(r, 0) != t1 && Database::text(r, 0) != t2); });   // only hashes are stored
}

static void test_legacy_import() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_legacy").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    std::string prev = GENESIS_HASH;
    {
        std::ofstream u(dir + "/users.txt"); u << "carol 0123456789abcdef " << std::string(64, 'a') << " 1001\n";
        std::ofstream c(dir + "/trades.csv");
        c << "id,ts,symbol,price_cents,qty,aggressor,buyer_acc,seller_acc,buy_order,sell_order,prev_hash,hash\n";
        for (int i = 1; i <= 3; i++) {
            Trade t; t.id = i; t.ts = 1700000000 + i; t.symbol = "MSFT"; t.price = 41200; t.qty = 5;
            t.buyerAcc = 1001; t.sellerAcc = 7; t.buyOrderId = 100 + i; t.sellOrderId = 200 + i;
            t.prevHash = prev; t.hash = hashOf(t, prev); prev = t.hash;
            c << t.id << ',' << t.ts << ",MSFT,41200,5,B,1001,7," << t.buyOrderId << ',' << t.sellOrderId << ',' << t.prevHash << ',' << t.hash << "\n";
        }
    }
    {
        Database db(dir + "/tradex.db");
        importLegacyFiles(db, dir);
        SqliteRepository repo(db);
        auto tr = repo.loadTrades();
        CHECK(tr.size() == 3 && verifyChain(tr).valid);                                       // chain survives the import
        UserManager um(db); int acc = 0; std::string err;
        long long users = 0; db.run("SELECT COUNT(*) FROM users", {}, [&](sqlite3_stmt* r) { users = Database::num(r, 0); });
        CHECK(users == 1);
        CHECK(!um.login("carol", "whatever1", err, acc));                                     // user exists (wrong password gives the normal error)
        CHECK(!std::filesystem::exists(dir + "/users.txt") && std::filesystem::exists(dir + "/trades.csv.imported"));
        importLegacyFiles(db, dir);                                                           // second start: nothing to do, nothing doubled
        CHECK(repo.loadTrades().size() == 3);
    }
}

static void test_persistence() {
    std::string dir = (std::filesystem::temp_directory_path() / "tradex_t_repo").string();
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    {
        Database db(dir + "/tradex.db"); SqliteRepository repo(db);
        std::string prev = GENESIS_HASH;
        for (int i = 1; i <= 500; i++) {
            Trade t; t.id = i; t.ts = 1700000000 + i; t.symbol = "AAPL"; t.price = 15000 + i; t.qty = 10;
            t.buyerAcc = 1001; t.sellerAcc = 5; t.buyOrderId = i; t.sellOrderId = i + 1;
            t.prevHash = prev; t.hash = hashOf(t, prev); prev = t.hash;
            repo.saveTrade(t);
        }
    }
    Database db(dir + "/tradex.db"); SqliteRepository repo(db);                               // reopen the file: nothing was lost
    auto trades = repo.loadTrades();
    CHECK(trades.size() == 500 && trades[499].id == 500 && trades[0].price == 15001 && trades[3].buyerAcc == 1001);
    CHECK(verifyChain(trades).valid);
    trades.erase(trades.begin() + 10);                                                       // a deleted trade breaks the chain
    auto v = verifyChain(trades);
    CHECK(!v.valid && v.brokenAtId == 12);
    CHECK(verifyChain({}).valid);

    // values are bound to ? marks, never pasted into the SQL text: SQL in a username is just text
    const std::string evil = "x'); DROP TABLE users;--";
    CHECK(db.run("INSERT INTO users VALUES(?,?,?,?)", {evil, std::string("salt"), std::string("hash"), 7LL}));
    std::string back; int rows = 0;
    CHECK(db.run("SELECT name FROM users", {}, [&](sqlite3_stmt* r) { back = Database::text(r, 0); rows++; }));
    CHECK(rows == 1 && back == evil);
    CHECK(!db.run("INSERT INTO users VALUES(?,?,?,?)", {evil, std::string("s"), std::string("h"), 8LL}));   // duplicate name is refused
}

static void test_bots_move_the_market() {
    TradingEngine e;
    e.seedBook(5000);
    SimulatedPriceSource sim;
    CHECK(sim.get("AAPL") == 15100 && sim.get("MSFT") == 41200);
    std::mt19937 rng(5);
    MarketMakerBot mm(1); RandomTakerBot tk(3);
    auto a = mm.decide(15100, rng); auto b = tk.decide(15100, rng);
    CHECK(a.price > 0 && b.price > 0 && a.qty > 0 && b.qty > 0);
    long long before = e.tradesTotal();
    BotManager bots(e, sim);
    bots.start();
    std::this_thread::sleep_for(std::chrono::milliseconds(3500));
    bots.stop();
    CHECK(bots.ordersSent() >= 5);
    CHECK(e.tradesTotal() > before);                                                          // takers crossed the spread
    CHECK(e.ordersPerSec() > 0);                                                              // the per-second sampler ran
    auto s = e.snapshot("AAPL");
    CHECK(s.bids.empty() || s.asks.empty() || s.bids[0].price < s.asks[0].price);
}

int main() {
    test_users(); test_legacy_import(); test_persistence(); test_bots_move_the_market();
    std::printf(failures ? "Service tests: %d FAILED\n" : "Service tests: all passed\n", failures);
    return failures ? 1 : 0;
}
