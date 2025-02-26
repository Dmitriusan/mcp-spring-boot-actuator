import { describe, it, expect } from "vitest";
import { parseHealth } from "../src/parsers/health.js";
import { analyzeMetrics } from "../src/analyzers/metrics.js";
import { analyzeEnv } from "../src/analyzers/env-risk.js";
import { analyzeBeans } from "../src/analyzers/beans.js";

// --- Health Parser Tests ---

describe("parseHealth", () => {
  it("parses healthy application", () => {
    const json = JSON.stringify({
      status: "UP",
      components: {
        db: { status: "UP", details: { database: "PostgreSQL", validationQuery: "isValid()" } },
        diskSpace: { status: "UP", details: { total: 107374182400, free: 53687091200, threshold: 10485760 } },
      },
    });
    const report = parseHealth(json);
    expect(report.overallStatus).toBe("UP");
    expect(report.components).toHaveLength(2);
    expect(report.issues.filter(i => i.severity === "CRITICAL")).toHaveLength(0);
  });

  it("detects DOWN database", () => {
    const json = JSON.stringify({
      status: "DOWN",
      components: {
        db: { status: "DOWN", details: { error: "Connection refused" } },
        diskSpace: { status: "UP", details: { total: 107374182400, free: 53687091200 } },
      },
    });
    const report = parseHealth(json);
    expect(report.overallStatus).toBe("DOWN");
    expect(report.issues.some(i => i.severity === "CRITICAL" && i.component === "db")).toBe(true);
    expect(report.recommendations.some(r => r.includes("Database"))).toBe(true);
  });

  it("detects DOWN redis", () => {
    const json = JSON.stringify({
      status: "DOWN",
      components: {
        redis: { status: "DOWN", details: { error: "REFUSED" } },
      },
    });
    const report = parseHealth(json);
    expect(report.issues.some(i => i.component === "redis")).toBe(true);
    expect(report.recommendations.some(r => r.includes("Redis"))).toBe(true);
  });

  it("warns on low disk space even if UP", () => {
    const json = JSON.stringify({
      status: "UP",
      components: {
        diskSpace: { status: "UP", details: { total: 100000000000, free: 10000000000 } },
      },
    });
    const report = parseHealth(json);
    expect(report.issues.some(i => i.severity === "WARNING" && i.component === "diskSpace")).toBe(true);
  });

  it("handles no components (restricted health endpoint)", () => {
    const json = JSON.stringify({ status: "UP" });
    const report = parseHealth(json);
    expect(report.overallStatus).toBe("UP");
    expect(report.components).toHaveLength(0);
    expect(report.recommendations.some(r => r.includes("show-details"))).toBe(true);
  });

  it("handles invalid JSON", () => {
    const report = parseHealth("not json");
    expect(report.overallStatus).toBe("UNKNOWN");
    expect(report.issues.some(i => i.severity === "CRITICAL")).toBe(true);
  });

  it("handles OUT_OF_SERVICE status", () => {
    const json = JSON.stringify({
      status: "OUT_OF_SERVICE",
      components: {
        custom: { status: "OUT_OF_SERVICE", details: { reason: "maintenance" } },
      },
    });
    const report = parseHealth(json);
    expect(report.overallStatus).toBe("OUT_OF_SERVICE");
    expect(report.issues.some(i => i.severity === "WARNING")).toBe(true);
  });

  it("parses nested components", () => {
    const json = JSON.stringify({
      status: "UP",
      components: {
        db: {
          status: "UP",
          components: {
            primary: { status: "UP", details: { database: "PostgreSQL" } },
            secondary: { status: "DOWN", details: { error: "timeout" } },
          },
        },
      },
    });
    const report = parseHealth(json);
    expect(report.issues.some(i => i.component === "secondary")).toBe(true);
  });
});

// --- Metrics Analyzer Tests ---

describe("analyzeMetrics", () => {
  it("detects high heap utilization", () => {
    const json = JSON.stringify({
      "jvm.memory.used": 900000000,
      "jvm.memory.max": 1000000000,
      "jvm.threads.live": 50,
      "jvm.threads.peak": 60,
      "jvm.threads.daemon": 30,
      "jvm.gc.pause.count": 100,
      "jvm.gc.pause.total": 2.5,
      "jvm.classes.loaded": 10000,
    });
    const report = analyzeMetrics(json);
    expect(report.jvm).not.toBeNull();
    expect(report.jvm!.heapUtilization).toBeGreaterThanOrEqual(0.9);
    expect(report.issues.some(i => i.severity === "CRITICAL" && i.category === "jvm.memory")).toBe(true);
  });

  it("detects high thread count", () => {
    const json = JSON.stringify({
      "jvm.memory.used": 500000000,
      "jvm.memory.max": 1000000000,
      "jvm.threads.live": 600,
      "jvm.threads.peak": 700,
    });
    const report = analyzeMetrics(json);
    expect(report.issues.some(i => i.category === "jvm.threads")).toBe(true);
  });

  it("detects high error rate", () => {
    const json = JSON.stringify({
      "http.server.requests.count": 1000,
      "http.server.requests.error.count": 200,
      "http.server.requests.max": 5000,
    });
    const report = analyzeMetrics(json);
    expect(report.http).not.toBeNull();
    expect(report.http!.errorRate).toBeGreaterThan(0.1);
    expect(report.issues.some(i => i.severity === "CRITICAL" && i.category === "http")).toBe(true);
  });

  it("detects DB pool exhaustion", () => {
    const json = JSON.stringify({
      "hikaricp.connections.active": 9,
      "hikaricp.connections.max": 10,
      "hikaricp.connections.pending": 3,
    });
    const report = analyzeMetrics(json);
    expect(report.issues.some(i => i.category === "db.pool" && i.severity === "CRITICAL")).toBe(true);
  });

  it("reports no issues for healthy metrics", () => {
    const json = JSON.stringify({
      "jvm.memory.used": 200000000,
      "jvm.memory.max": 1000000000,
      "jvm.threads.live": 30,
    });
    const report = analyzeMetrics(json);
    expect(report.issues.filter(i => i.severity === "CRITICAL")).toHaveLength(0);
  });

  it("handles invalid JSON", () => {
    const report = analyzeMetrics("broken");
    expect(report.issues.some(i => i.severity === "CRITICAL")).toBe(true);
  });

  it("handles Spring Boot measurement format", () => {
    const json = JSON.stringify({
      "jvm.memory.used": {
        measurements: [{ statistic: "VALUE", value: 800000000 }],
      },
      "jvm.memory.max": {
        measurements: [{ statistic: "VALUE", value: 1000000000 }],
      },
    });
    const report = analyzeMetrics(json);
    expect(report.jvm).not.toBeNull();
    expect(report.jvm!.heapUsed).toBe(800000000);
  });
});

// --- Env Risk Tests ---

describe("analyzeEnv", () => {
  it("detects exposed secrets", () => {
    const json = JSON.stringify({
      propertySources: [
        {
          name: "applicationConfig",
          properties: {
            "spring.datasource.password": { value: "supersecret123" },
            "spring.datasource.url": { value: "jdbc:postgresql://localhost/mydb" },
          },
        },
      ],
    });
    const report = analyzeEnv(json);
    expect(report.risks.some(r => r.severity === "CRITICAL" && r.property.includes("password"))).toBe(true);
  });

  it("ignores masked secrets", () => {
    const json = JSON.stringify({
      propertySources: [
        {
          name: "applicationConfig",
          properties: {
            "spring.datasource.password": { value: "******" },
          },
        },
      ],
    });
    const report = analyzeEnv(json);
    expect(report.risks.filter(r => r.severity === "CRITICAL")).toHaveLength(0);
  });

  it("flags ddl-auto create-drop", () => {
    const json = JSON.stringify({
      propertySources: [
        {
          name: "applicationConfig",
          properties: {
            "spring.jpa.hibernate.ddl-auto": { value: "create-drop" },
          },
        },
      ],
    });
    const report = analyzeEnv(json);
    expect(report.risks.some(r => r.property.includes("ddl-auto"))).toBe(true);
  });

  it("flags H2 console enabled", () => {
    const json = JSON.stringify({
      propertySources: [
        {
          name: "applicationConfig",
          properties: {
            "spring.h2.console.enabled": { value: "true" },
          },
        },
      ],
    });
    const report = analyzeEnv(json);
    expect(report.risks.some(r => r.message.includes("H2 console"))).toBe(true);
  });

  it("warns about no active profiles", () => {
    const json = JSON.stringify({
      activeProfiles: [],
      propertySources: [],
    });
    const report = analyzeEnv(json);
    expect(report.risks.some(r => r.property.includes("profiles"))).toBe(true);
  });

  it("handles invalid JSON", () => {
    const report = analyzeEnv("bad");
    expect(report.risks.some(r => r.severity === "CRITICAL")).toBe(true);
  });

  it("flags exposed all actuator endpoints", () => {
    const json = JSON.stringify({
      activeProfiles: ["production"],
      propertySources: [
        {
          name: "config",
          properties: {
            "management.endpoints.web.exposure.include": { value: "*" },
          },
        },
      ],
    });
    const report = analyzeEnv(json);
    expect(report.risks.some(r => r.message.includes("actuator endpoints"))).toBe(true);
  });
});

// --- Beans Analyzer Tests ---

describe("analyzeBeans", () => {
  it("detects circular dependencies", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            serviceA: { scope: "singleton", type: "com.example.ServiceA", dependencies: ["serviceB"] },
            serviceB: { scope: "singleton", type: "com.example.ServiceB", dependencies: ["serviceA"] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.totalBeans).toBe(2);
    expect(report.issues.some(i => i.message.includes("Circular dependency"))).toBe(true);
  });

  it("detects scope mismatch", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            singletonService: { scope: "singleton", type: "com.example.Single", dependencies: ["prototypeBean"] },
            prototypeBean: { scope: "prototype", type: "com.example.Proto", dependencies: [] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.issues.some(i => i.message.includes("Singleton") && i.message.includes("prototype"))).toBe(true);
  });

  it("flags high dependency count", () => {
    const deps = Array.from({ length: 12 }, (_, i) => `dep${i}`);
    const beans: Record<string, unknown> = {
      godObject: { scope: "singleton", type: "com.example.GodService", dependencies: deps },
    };
    for (const dep of deps) {
      beans[dep] = { scope: "singleton", type: "com.example.Dep", dependencies: [] };
    }
    const json = JSON.stringify({ contexts: { application: { beans } } });
    const report = analyzeBeans(json);
    expect(report.issues.some(i => i.message.includes(">10 dependencies"))).toBe(true);
  });

  it("handles empty beans", () => {
    const json = JSON.stringify({ contexts: { application: { beans: {} } } });
    const report = analyzeBeans(json);
    expect(report.totalBeans).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it("handles invalid JSON", () => {
    const report = analyzeBeans("nope");
    expect(report.issues.some(i => i.severity === "CRITICAL")).toBe(true);
  });

  it("reports no issues for clean bean graph", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            controller: { scope: "singleton", type: "com.example.Controller", dependencies: ["service"] },
            service: { scope: "singleton", type: "com.example.Service", dependencies: ["repository"] },
            repository: { scope: "singleton", type: "com.example.Repository", dependencies: [] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.totalBeans).toBe(3);
    expect(report.issues.filter(i => i.severity === "CRITICAL" || i.severity === "WARNING")).toHaveLength(0);
  });

  it("counts beans across multiple contexts", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            bean1: { scope: "singleton", type: "a.B", dependencies: [] },
          },
        },
        child: {
          beans: {
            bean2: { scope: "singleton", type: "a.C", dependencies: [] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.totalBeans).toBe(2);
    expect(report.contexts).toContain("application");
    expect(report.contexts).toContain("child");
  });
});

// --- Edge Case Tests ---

describe("parseHealth — edge cases", () => {
  it("handles empty JSON object", () => {
    const report = parseHealth("{}");
    expect(report.overallStatus).toBe("UNKNOWN");
  });

  it("handles UNKNOWN status explicitly", () => {
    const json = JSON.stringify({
      status: "UNKNOWN",
      components: { custom: { status: "UNKNOWN" } },
    });
    const report = parseHealth(json);
    expect(report.overallStatus).toBe("UNKNOWN");
  });
});

describe("analyzeMetrics — edge cases", () => {
  it("handles empty JSON object", () => {
    const report = analyzeMetrics("{}");
    expect(report.jvm).toBeNull();
    expect(report.http).toBeNull();
  });

  it("handles metrics with zero memory max (avoids division by zero)", () => {
    const json = JSON.stringify({
      "jvm.memory.used": 0,
      "jvm.memory.max": 0,
    });
    const report = analyzeMetrics(json);
    // Should not crash or produce NaN/Infinity
    expect(report.issues.every(i => !i.message.includes("NaN"))).toBe(true);
  });

  it("extracts per-endpoint metrics from http.server.requests.by.uri", () => {
    const json = JSON.stringify({
      "http.server.requests.count": 500,
      "http.server.requests.by.uri": [
        { uri: "/api/users", method: "GET", count: 300, meanMs: 45.2, maxMs: 250, errorCount: 5 },
        { uri: "/api/orders", method: "POST", count: 150, meanMs: 120.5, maxMs: 800, errorCount: 10 },
        { uri: "/health", method: "GET", count: 50, meanMs: 2.1, maxMs: 10, errorCount: 0 },
      ],
    });
    const report = analyzeMetrics(json);
    expect(report.http).not.toBeNull();
    expect(report.http!.endpoints).toHaveLength(3);
    expect(report.http!.endpoints[0].uri).toBe("/api/users");
    expect(report.http!.endpoints[0].count).toBe(300);
    expect(report.http!.endpoints[0].meanMs).toBe(45.2);
    expect(report.http!.endpoints[1].uri).toBe("/api/orders");
    expect(report.http!.endpoints[1].errorCount).toBe(10);
    expect(report.http!.endpoints[2].uri).toBe("/health");
  });

  it("handles missing http.server.requests.by.uri gracefully", () => {
    const json = JSON.stringify({
      "http.server.requests.count": 100,
    });
    const report = analyzeMetrics(json);
    expect(report.http).not.toBeNull();
    expect(report.http!.endpoints).toHaveLength(0);
  });

  it("handles HikariCP connections.pending as null", () => {
    const json = JSON.stringify({
      "hikaricp.connections.active": 5,
      "hikaricp.connections.max": 10,
    });
    const report = analyzeMetrics(json);
    // Should not produce a pending connections warning when key is absent
    expect(report.issues.some(i => i.message.includes("waiting for a database connection"))).toBe(false);
  });

  it("warns when HikariCP connections.pending is non-zero", () => {
    const json = JSON.stringify({
      "hikaricp.connections.active": 5,
      "hikaricp.connections.max": 10,
      "hikaricp.connections.pending": 3,
    });
    const report = analyzeMetrics(json);
    expect(report.issues.some(i => i.message.includes("3 threads waiting"))).toBe(true);
  });

  it("warns on extremely high max HTTP latency", () => {
    const json = JSON.stringify({
      "http.server.requests.count": 100,
      "http.server.requests.max": 15000,
    });
    const report = analyzeMetrics(json);
    expect(report.issues.some(i => i.category === "http.latency")).toBe(true);
    expect(report.recommendations.some(r => r.includes("slowest endpoints"))).toBe(true);
  });

  it("handles Spring Boot measurement format for JVM metrics", () => {
    const json = JSON.stringify({
      "jvm.memory.used": {
        measurements: [{ statistic: "VALUE", value: 500000000 }],
      },
      "jvm.memory.max": {
        measurements: [{ statistic: "VALUE", value: 1000000000 }],
      },
    });
    const report = analyzeMetrics(json);
    expect(report.jvm).not.toBeNull();
    expect(report.jvm!.heapUsed).toBe(500000000);
    expect(report.jvm!.heapMax).toBe(1000000000);
    expect(report.jvm!.heapUtilization).toBe(0.5);
  });
});

describe("analyzeEnv — edge cases", () => {
  it("handles empty property sources", () => {
    const json = JSON.stringify({ propertySources: [] });
    const report = analyzeEnv(json);
    // No crashes, might flag no active profiles
    expect(Array.isArray(report.risks)).toBe(true);
  });

  it("handles property source without properties key", () => {
    const json = JSON.stringify({
      activeProfiles: ["prod"],
      propertySources: [{ name: "empty" }],
    });
    const report = analyzeEnv(json);
    expect(Array.isArray(report.risks)).toBe(true);
  });
});

describe("analyzeBeans — edge cases", () => {
  it("detects 3-node circular dependency (A→B→C→A)", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            serviceA: { scope: "singleton", type: "com.A", dependencies: ["serviceB"] },
            serviceB: { scope: "singleton", type: "com.B", dependencies: ["serviceC"] },
            serviceC: { scope: "singleton", type: "com.C", dependencies: ["serviceA"] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.issues.some(i => i.message.includes("Circular"))).toBe(true);
  });

  it("handles beans with empty dependencies array", () => {
    const json = JSON.stringify({
      contexts: {
        application: {
          beans: {
            solo: { scope: "singleton", type: "com.Solo", dependencies: [] },
          },
        },
      },
    });
    const report = analyzeBeans(json);
    expect(report.totalBeans).toBe(1);
    expect(report.issues).toHaveLength(0);
  });
});

// --- Integration Test ---

describe("full actuator analysis", () => {
  it("analyzes a troubled application", () => {
    // Health: DB down
    const health = parseHealth(JSON.stringify({
      status: "DOWN",
      components: {
        db: { status: "DOWN", details: { error: "Connection refused" } },
        diskSpace: { status: "UP", details: { total: 100000000000, free: 5000000000 } },
      },
    }));
    expect(health.overallStatus).toBe("DOWN");
    expect(health.issues.filter(i => i.severity === "CRITICAL").length).toBeGreaterThanOrEqual(1);

    // Metrics: high heap, pool exhaustion
    const metrics = analyzeMetrics(JSON.stringify({
      "jvm.memory.used": 950000000,
      "jvm.memory.max": 1000000000,
      "hikaricp.connections.active": 10,
      "hikaricp.connections.max": 10,
    }));
    expect(metrics.issues.filter(i => i.severity === "CRITICAL").length).toBeGreaterThanOrEqual(2);

    // Env: secrets exposed
    const env = analyzeEnv(JSON.stringify({
      activeProfiles: [],
      propertySources: [{
        name: "config",
        properties: {
          "spring.datasource.password": { value: "plaintext_password" },
          "spring.jpa.hibernate.ddl-auto": { value: "create" },
        },
      }],
    }));
    expect(env.risks.filter(r => r.severity === "CRITICAL").length).toBeGreaterThanOrEqual(1);

    // Beans: circular dependency
    const beans = analyzeBeans(JSON.stringify({
      contexts: { application: { beans: {
        a: { scope: "singleton", type: "A", dependencies: ["b"] },
        b: { scope: "singleton", type: "B", dependencies: ["a"] },
      }}},
    }));
    expect(beans.issues.some(i => i.message.includes("Circular"))).toBe(true);
  });
});
