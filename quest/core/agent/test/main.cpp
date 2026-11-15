// Runs every test, or with --outbound prints every outbound message for outbound.ts to check against
// the service's own schema.
#include "support.h"

int main(int argc, char** argv) {
    if (argc > 1 && std::string(argv[1]) == "--outbound") {
        for (const auto& [message, expected] : outboundCases()) std::printf("%s\n", message.text().c_str());
        return 0;
    }
    int failedTests = 0;
    for (const check::Test& test : check::all()) {
        int before = check::failures();
        test.run();
        bool passed = check::failures() == before;
        failedTests += !passed;
        std::printf("  %s %s\n", passed ? "ok    " : "FAILED", test.name);
    }
    std::printf("%zu tests, %d failed, %d failed checks\n", check::all().size(), failedTests, check::failures());
    return failedTests == 0 ? 0 : 1;
}
