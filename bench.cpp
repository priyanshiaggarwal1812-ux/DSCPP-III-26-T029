// Prints the measured benchmark (the same code the Performance page uses).   make bench
#include <cstdio>
#include "engine/Benchmark.h"
using namespace tx;

int main() {
    std::printf("Running benchmark (20,000 resting orders, then 1,500 test orders)...\n\n");
    BenchResult r = runBenchmark();
    std::printf("RAM vs disk (%d orders, %lld trades written)\n", r.diskOrders, r.diskTrades);
    std::printf("  matching in RAM only           : %8.2f us per order\n", r.ramUs);
    std::printf("  + database write per trade:      %8.2f us per order  (%.0fx slower)\n", r.diskUs, r.ramUs > 0 ? r.diskUs / r.ramUs : 0);
    return 0;
}
