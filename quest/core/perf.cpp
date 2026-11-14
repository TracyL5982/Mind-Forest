#include "perf.h"

#include <algorithm>

#include "base.h"

void Perf::open(const std::string& path) {
    close();
    file = fopen(path.c_str(), "w");
    if (!file) {
        logLine("[perf] can't write " + path);
        return;
    }
    fprintf(file, "time,interval_ms,cpu_ms,update_ms,build_ms,submit_ms,gpu_ms,draw_calls,triangles,culled,uploads,upload_bytes\n");
}

void Perf::add(const Frame& f, bool log) {
    if (file) {
        fprintf(file, "%.4f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%d,%d,%d,%d,%d\n", f.time, f.intervalMs, f.cpuMs, f.updateMs, f.buildMs,
                f.submitMs, f.gpuMs, f.drawCalls, f.triangles, f.culled, f.uploads, f.uploadBytes);
    }
    if (!log) return;
    if (secondBegan < 0) secondBegan = f.time;
    second.push_back(f);
    if (f.time - secondBegan < 1) return;
    double cpu = 0, cpuMax = 0, update = 0, updateMax = 0, gpu = 0, intervalMax = 0, draws = 0, tris = 0, submit = 0;
    for (const Frame& s : second) {
        cpu += s.cpuMs;
        cpuMax = std::max(cpuMax, s.cpuMs);
        update += s.updateMs;
        updateMax = std::max(updateMax, s.updateMs);
        submit += s.buildMs + s.submitMs;
        gpu += s.gpuMs;
        intervalMax = std::max(intervalMax, s.intervalMs);
        draws += s.drawCalls;
        tris += s.triangles;
    }
    double n = double(second.size());
    logLine(fmt("[perf] %.1f fps (worst gap %.1f ms) · cpu %.2f ms (worst %.2f): update %.2f (worst %.2f), draw %.2f · gpu %.2f ms · %d draws, %d tris",
                n / (f.time - secondBegan), intervalMax, cpu / n, cpuMax, update / n, updateMax, submit / n, gpu / n, int(draws / n), int(tris / n)));
    second.clear();
    secondBegan = f.time;
    if (file) fflush(file);
}

void Perf::close() {
    if (file) fclose(file);
    file = nullptr;
}
