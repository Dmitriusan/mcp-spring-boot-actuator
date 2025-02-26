import { describe, it, expect } from "vitest";
import { analyzeStartup } from "../src/analyzers/startup.js";
import { analyzeCaches } from "../src/analyzers/caches.js";

// --- Startup Analyzer Tests ---

describe("analyzeStartup", () => {
  it("parses startup timeline with events", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT5.123S" },
        events: [
          {
            duration: "PT2.5S",
            startupStep: {
              name: "spring.beans.instantiate",
              id: 1,
              parentId: null,
              tags: [{ key: "beanName", value: "dataSource" }],
            },
          },
          {
            duration: "PT0.1S",
            startupStep: {
              name: "spring.beans.instantiate",
              id: 2,
              parentId: null,
              tags: [{ key: "beanName", value: "userService" }],
            },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.totalDurationMs).toBeCloseTo(5123, -1);
    expect(report.steps.length).toBe(2);
    expect(report.steps[0].durationMs).toBeGreaterThan(report.steps[1].durationMs);
  });

  it("detects slow startup (>30s)", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT45S" },
        events: [],
      },
    });
    const report = analyzeStartup(json);
    expect(report.issues.some(i => i.severity === "CRITICAL" && i.message.includes("45"))).toBe(true);
    expect(report.recommendations.some(r => r.includes("lazy"))).toBe(true);
  });

  it("detects moderate startup (15-30s)", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT20S" },
        events: [],
      },
    });
    const report = analyzeStartup(json);
    expect(report.issues.some(i => i.severity === "WARNING")).toBe(true);
  });

  it("handles missing timeline", () => {
    const json = JSON.stringify({});
    const report = analyzeStartup(json);
    expect(report.issues.some(i => i.message.includes("No timeline"))).toBe(true);
  });

  it("handles invalid JSON", () => {
    const report = analyzeStartup("not json");
    expect(report.issues.some(i => i.severity === "CRITICAL")).toBe(true);
  });

  it("detects slow bean initialization (>2s)", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT10S" },
        events: [
          {
            duration: "PT3.5S",
            startupStep: {
              name: "spring.beans.instantiate",
              id: 1,
              parentId: null,
              tags: [{ key: "beanName", value: "heavyBean" }],
            },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.issues.some(i => i.message.includes("heavyBean"))).toBe(true);
  });

  it("reports healthy startup", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT3S" },
        events: [
          {
            duration: "PT0.5S",
            startupStep: { name: "spring.context.refresh", id: 1, parentId: null, tags: [] },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.issues.filter(i => i.severity === "CRITICAL" || i.severity === "WARNING")).toHaveLength(0);
    expect(report.recommendations.some(r => r.includes("healthy"))).toBe(true);
  });

  it("parses millisecond durations", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: 5000 },
        events: [
          {
            duration: 1500,
            startupStep: { name: "step1", id: 1, parentId: null, tags: [] },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.totalDurationMs).toBe(5000);
    expect(report.steps[0].durationMs).toBe(1500);
  });
});

// --- Cache Analyzer Tests ---

describe("analyzeCaches", () => {
  it("lists registered caches", () => {
    const json = JSON.stringify({
      cacheManagers: {
        cacheManager: {
          caches: {
            users: { target: "org.springframework.cache.caffeine.CaffeineCache" },
            products: { target: "org.springframework.cache.caffeine.CaffeineCache" },
          },
        },
      },
    });
    const report = analyzeCaches(json);
    expect(report.caches.length).toBe(2);
    expect(report.caches[0].name).toBe("users");
    expect(report.caches[0].cacheManager).toBe("cacheManager");
  });

  it("detects unbounded ConcurrentMapCache", () => {
    const json = JSON.stringify({
      cacheManagers: {
        cacheManager: {
          caches: {
            sessions: { target: "org.springframework.cache.concurrent.ConcurrentMapCache" },
          },
        },
      },
    });
    const report = analyzeCaches(json);
    expect(report.issues.some(i => i.severity === "WARNING" && i.message.includes("unbounded"))).toBe(true);
  });

  it("warns about too many caches (>20)", () => {
    const caches: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      caches[`cache${i}`] = { target: "CaffeineCache" };
    }
    const json = JSON.stringify({
      cacheManagers: { main: { caches } },
    });
    const report = analyzeCaches(json);
    expect(report.issues.some(i => i.message.includes("25 caches"))).toBe(true);
    expect(report.recommendations.some(r => r.includes("consolidate") || r.includes("Consolidate"))).toBe(true);
  });

  it("handles no cache managers", () => {
    const json = JSON.stringify({ cacheManagers: {} });
    const report = analyzeCaches(json);
    expect(report.issues.some(i => i.message.includes("No cache managers"))).toBe(true);
  });

  it("handles invalid JSON", () => {
    const report = analyzeCaches("broken");
    expect(report.issues.some(i => i.severity === "CRITICAL")).toBe(true);
  });

  it("handles empty caches in manager", () => {
    const json = JSON.stringify({
      cacheManagers: {
        main: { caches: {} },
      },
    });
    const report = analyzeCaches(json);
    expect(report.caches.length).toBe(0);
    expect(report.issues.some(i => i.message.includes("No caches registered"))).toBe(true);
  });

  it("reports healthy when caches look good", () => {
    const json = JSON.stringify({
      cacheManagers: {
        main: {
          caches: {
            users: { target: "CaffeineCache" },
            config: { target: "CaffeineCache" },
          },
        },
      },
    });
    const report = analyzeCaches(json);
    expect(report.caches.length).toBe(2);
    expect(report.recommendations.some(r => r.includes("2 cache(s)"))).toBe(true);
  });

  it("handles multiple cache managers", () => {
    const json = JSON.stringify({
      cacheManagers: {
        caffeine: {
          caches: { users: { target: "CaffeineCache" } },
        },
        redis: {
          caches: { sessions: { target: "RedisCache" } },
        },
      },
    });
    const report = analyzeCaches(json);
    expect(report.caches.length).toBe(2);
    expect(report.caches.some(c => c.cacheManager === "caffeine")).toBe(true);
    expect(report.caches.some(c => c.cacheManager === "redis")).toBe(true);
  });

  it("detects simple cache provider", () => {
    const json = JSON.stringify({
      cacheManagers: {
        main: {
          caches: { temp: { target: "simple" } },
        },
      },
    });
    const report = analyzeCaches(json);
    expect(report.issues.some(i => i.message.includes("unbounded"))).toBe(true);
  });

  it("handles cacheManagers key missing entirely", () => {
    const json = JSON.stringify({ status: "UP" });
    const report = analyzeCaches(json);
    expect(report.issues.some(i => i.message.includes("No cache managers"))).toBe(true);
  });
});

// --- Startup Analyzer Edge Cases ---

describe("analyzeStartup — edge cases", () => {
  it("handles startup with 0 events (empty timeline)", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT2S" },
        events: [],
      },
    });
    const report = analyzeStartup(json);
    expect(report.totalDurationMs).toBeCloseTo(2000, -1);
    expect(report.steps).toHaveLength(0);
    expect(report.slowSteps).toHaveLength(0);
    expect(report.recommendations.some(r => r.includes("healthy"))).toBe(true);
  });

  it("handles startup with all beans < 1s (fast healthy startup)", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      duration: `PT0.${i + 1}S`,
      startupStep: {
        name: "spring.beans.instantiate",
        id: i + 1,
        parentId: null,
        tags: [{ key: "beanName", value: `fastBean${i}` }],
      },
    }));
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT3S" },
        events,
      },
    });
    const report = analyzeStartup(json);
    expect(report.steps).toHaveLength(20);
    // No slow beans (all < 2s)
    expect(report.issues.filter(i => i.message.includes("took"))).toHaveLength(0);
  });

  it("handles startup with ms string durations", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "2500ms" },
        events: [
          {
            duration: "750ms",
            startupStep: { name: "init", id: 1, parentId: null, tags: [] },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.totalDurationMs).toBe(2500);
    expect(report.steps[0].durationMs).toBe(750);
  });

  it("detects heavy auto-configuration", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT10S" },
        events: [
          {
            duration: "PT4S",
            startupStep: {
              name: "spring.context.auto-configuration",
              id: 1,
              parentId: null,
              tags: [],
            },
          },
          {
            duration: "PT2S",
            startupStep: {
              name: "spring.beans.instantiate",
              id: 2,
              parentId: null,
              tags: [{ key: "beanName", value: "HibernateAutoConfiguration" }],
            },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.issues.some(i => i.message.includes("Auto-configuration"))).toBe(true);
    expect(report.recommendations.some(r => r.includes("exclude"))).toBe(true);
  });

  it("handles events without startupStep", () => {
    const json = JSON.stringify({
      timeline: {
        startupTime: { totalTime: "PT1S" },
        events: [
          { duration: "PT0.5S" }, // missing startupStep
          {
            duration: "PT0.3S",
            startupStep: { name: "valid", id: 1, parentId: null, tags: [] },
          },
        ],
      },
    });
    const report = analyzeStartup(json);
    expect(report.steps).toHaveLength(1); // Only the valid one
    expect(report.steps[0].name).toBe("valid");
  });
});
