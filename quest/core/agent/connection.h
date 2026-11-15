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

/// The service a build joins by itself, and its key: the judging build's, from ~/.mind-palace/judging.properties.
struct BuiltIn {
    std::string agent;
    std::string token;
};

/// A launch with `-agent` remembers it, with its `-agentToken` and whether it had `-cards`. A launch with no `-agent` joins
/// the remembered connection. `-agentForget` forgets it, and that launch joins only if it was given `-agent` itself.
/// A build with a service of its own (`builtIn`) joins it, with the cards, unless the launch gives `-agent`, which it then
/// joins that once. It neither reads nor saves the file.
Launch launch(const std::vector<std::string>& given, const std::optional<std::string>& saved, const std::optional<BuiltIn>& builtIn = std::nullopt);

/// This headset's id for the service, 32 hex digits: made on its first launch and kept in `file`, in the app's own
/// storage, so every launch after gives the same one until the app is removed.
std::string deviceId(const std::string& file);

}  // namespace agent
