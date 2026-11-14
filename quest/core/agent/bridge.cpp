#include "bridge.h"

#include "base.h"
#include "ocean/oceanmodel.h"

namespace agent {

std::shared_ptr<Bridge> Bridge::fromFlags(OceanModel&) {
    std::optional<std::string> address = Flags::string("agent");
    if (!address) return nullptr;
    logLine("[agent] -agent " + *address + ": the client is not built yet; the ocean runs as it was");
    return nullptr;
}

}  // namespace agent
