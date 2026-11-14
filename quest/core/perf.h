// What each frame cost, kept by the host: a line per frame in a CSV for the
// Mac to pull (tools/perf.py), and a summary each second in the log.
#pragma once
#include <cstdio>
#include <string>
#include <vector>

class Perf {
public:
    struct Frame {
        double time = 0;            // s since the scene started
        double intervalMs = 0;      // since the last frame was handed over: 11.1 at 90 Hz when every frame is made in time
        double cpuMs = 0;           // this thread's work for the frame, from waking to handing it over
        double updateMs = 0;        // of that: input and the scene's update
        double buildMs = 0;         // walking the scene and sorting
        double submitMs = 0;        // issuing GL calls
        double gpuMs = 0;           // the GPU's time for a recent frame (timer query), if reported
        int drawCalls = 0;
        int triangles = 0;
        int culled = 0;
        int uploads = 0;            // meshes and textures sent to the GPU this frame
        int uploadBytes = 0;
    };
    void open(const std::string& path);
    void add(const Frame& f, bool log);
    void close();
    ~Perf() { close(); }

private:
    FILE* file = nullptr;
    std::vector<Frame> second;
    double secondBegan = -1;
};
