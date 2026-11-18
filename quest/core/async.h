// Work done off the frame thread: to read a file, the slow part goes to one
// background thread, and what follows runs on the frame thread at the start
// of a later frame.
#pragma once
#include <functional>

namespace Async {
/// Runs `work` on the background thread, then `then` (if any) on the frame thread.
void run(std::function<void()> work, std::function<void()> then = nullptr);
/// Hosts call this once a frame, before the scene's update: runs what has come back.
/// With `wait`, first waits until nothing is still out (for pictures that must come out the same every run).
void drain(bool wait = false);
}
