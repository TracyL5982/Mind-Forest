// The connection to the agent service the headset remembers between launches, in the app's own storage
// (agent-connection.json), so the app joins the service when it is started from the app library with no launch flags.
#pragma once
#include <optional>
#include <string>
#include <vector>

namespace agent {

/// What a launch does with the remembered connection, from its launch arguments and the file.
struct Launch {
    enum class File { keep, save, forget };
    /// The arguments the app runs with: the ones given, and the remembered connection's when no `-agent` was given.
    std::vector<std::string> arguments;
    File file = File::keep;
    /// The file's new text, when it is saved.
    std::string text;
    /// A line for the log, empty when there is nothing to say. It never holds the token.
    std::string said;
};

/// A launch with `-agent` remembers it, with its `-agentToken` and whether it had `-cards`. A launch with no `-agent` joins
/// the remembered connection. `-agentForget` forgets it, and that launch joins only if it was given `-agent` itself.
Launch launch(const std::vector<std::string>& given, const std::optional<std::string>& saved);

}  // namespace agent
