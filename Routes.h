#pragma once
#include <atomic>
#include <string>
#include "auth/UserManager.h"
#include "bots/Bots.h"
#include "engine/Benchmark.h"
#include "engine/TradingEngine.h"

namespace httplib { class Server; }

namespace tx {

// Everything the route handlers need. main.cpp creates the objects and passes references.
struct AppContext {
    TradingEngine& engine;
    UserManager& users;
    SessionManager& sessions;
    BotManager& bots;
    BenchState& bench;
    std::atomic<bool>& stopping;         // set on Ctrl+C: live streams end
    std::atomic<int>& streamClients;     // open /stream connections
};

// Adds every API route to the cpp-httplib server. (The website files are served by the server's mount point, see main.cpp.)
void registerRoutes(httplib::Server& server, AppContext& ctx);

}  // namespace tx
