#include "async.h"

#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

#include "base.h"
#include "platform.h"

namespace Async {

namespace {
struct Job {
    std::function<void()> work, then;
};
std::mutex mutex;
std::condition_variable wake, settled;
std::deque<Job> jobs;
std::vector<std::function<void()>> back;
int out = 0;            // handed over and not yet finished
bool started = false;

void loop() {
    for (;;) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(mutex);
            wake.wait(lock, [] { return !jobs.empty(); });
            job = std::move(jobs.front());
            jobs.pop_front();
        }
        if (job.work) job.work();
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (job.then) back.push_back(std::move(job.then));
            out--;
        }
        settled.notify_all();
    }
}
}  // namespace

void run(std::function<void()> work, std::function<void()> then) {
    {
        std::lock_guard<std::mutex> lock(mutex);
        if (!started) {
            started = true;
            std::thread(loop).detach();
        }
        jobs.push_back({std::move(work), std::move(then)});
        out++;
    }
    wake.notify_one();
}

void drain(bool wait) {
    std::vector<std::function<void()>> ready;
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (wait) settled.wait(lock, [] { return out == 0; });
        ready.swap(back);
    }
    for (auto& f : ready) f();
}

}  // namespace Async

// MARK: - Pictures, unpacked ahead of time

namespace platform {

namespace {
struct Waiting {
    ImageRef image;
    bool ready = false;
    double asked = 0;
};
using Key = std::pair<std::string, int>;
std::mutex pictures;
std::condition_variable arrived;
std::map<Key, std::shared_ptr<Waiting>> ahead;
}  // namespace

void prefetchImage(const std::string& path, int maxPixel) {
    if (path.empty()) return;
    Key key{path, maxPixel};
    std::shared_ptr<Waiting> entry;
    {
        std::lock_guard<std::mutex> lock(pictures);
        // What was asked for and never collected (its card went away) is let go after a while.
        double now = mediaTime();
        for (auto it = ahead.begin(); it != ahead.end();) {
            if (it->second->ready && now - it->second->asked > 20) it = ahead.erase(it);
            else ++it;
        }
        if (ahead.count(key)) return;
        entry = std::make_shared<Waiting>();
        entry->asked = now;
        ahead[key] = entry;
    }
    Async::run([entry, path, maxPixel] {
        ImageRef image = decodeImage(path, maxPixel);
        {
            std::lock_guard<std::mutex> lock(pictures);
            entry->image = image;
            entry->ready = true;
        }
        arrived.notify_all();
    });
}

bool imageReady(const std::string& path, int maxPixel) {
    std::lock_guard<std::mutex> lock(pictures);
    auto it = ahead.find({path, maxPixel});
    return it != ahead.end() && it->second->ready;
}

ImageRef loadImage(const std::string& path, int maxPixel) {
    std::shared_ptr<Waiting> entry;
    {
        std::unique_lock<std::mutex> lock(pictures);
        auto it = ahead.find({path, maxPixel});
        if (it != ahead.end()) {
            entry = it->second;
            // Already on its way: wait for that one rather than unpack it twice.
            arrived.wait(lock, [&] { return entry->ready; });
            ahead.erase({path, maxPixel});
            return entry->image;
        }
    }
    return decodeImage(path, maxPixel);
}

}  // namespace platform
