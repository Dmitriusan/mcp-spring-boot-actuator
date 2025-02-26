import { describe, it, expect } from "vitest";
import { analyzeLoggers } from "../src/analyzers/loggers.js";

const HEALTHY_LOGGERS = JSON.stringify({
  loggers: {
    ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
    "org.springframework": { configuredLevel: null, effectiveLevel: "INFO" },
    "org.hibernate": { configuredLevel: null, effectiveLevel: "INFO" },
    "com.example.app": { configuredLevel: null, effectiveLevel: "INFO" },
  },
});

describe("analyzeLoggers — basic parsing", () => {
  it("should parse loggers from valid JSON", () => {
    const result = analyzeLoggers(HEALTHY_LOGGERS);
    expect(result.loggers.length).toBe(4);
  });

  it("should report no issues for healthy configuration", () => {
    const result = analyzeLoggers(HEALTHY_LOGGERS);
    expect(result.issues.length).toBe(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("should handle invalid JSON gracefully", () => {
    const result = analyzeLoggers("not valid json");
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].severity).toBe("CRITICAL");
    expect(result.issues[0].message).toContain("Invalid JSON");
  });

  it("should handle empty loggers object", () => {
    const result = analyzeLoggers(JSON.stringify({ loggers: {} }));
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].message).toContain("No loggers found");
  });
});

describe("analyzeLoggers — DEBUG/TRACE detection", () => {
  it("should detect ROOT logger at DEBUG level", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "com.example": { configuredLevel: null, effectiveLevel: "DEBUG" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.severity === "CRITICAL" && i.message.includes("ROOT"))).toBe(true);
  });

  it("should detect ROOT logger at TRACE level", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "TRACE", effectiveLevel: "TRACE" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.severity === "CRITICAL" && i.message.includes("ROOT"))).toBe(true);
  });

  it("should detect explicitly configured DEBUG loggers", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "com.example.service": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "com.example.repo": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.message.includes("DEBUG/TRACE"))).toBe(true);
  });

  it("should not flag non-configured loggers with DEBUG effective level", () => {
    // If ROOT is DEBUG, children inherit it but aren't "explicitly configured"
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "com.example": { configuredLevel: null, effectiveLevel: "INFO" },
      },
    });
    const result = analyzeLoggers(json);
    const debugWarnings = result.issues.filter((i) => i.message.includes("DEBUG/TRACE"));
    expect(debugWarnings.length).toBe(0);
  });
});

describe("analyzeLoggers — framework detection", () => {
  it("should detect verbose Spring framework logging", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "org.springframework.web": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "org.springframework.data": { configuredLevel: null, effectiveLevel: "INFO" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.message.includes("org.springframework"))).toBe(true);
  });

  it("should detect verbose Hibernate logging", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "org.hibernate.SQL": { configuredLevel: "TRACE", effectiveLevel: "TRACE" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.message.includes("org.hibernate"))).toBe(true);
  });
});

describe("analyzeLoggers — inconsistent levels", () => {
  it("should detect inconsistent levels within a package", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "com.example.service.UserService": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "com.example.service.OrderService": { configuredLevel: "WARN", effectiveLevel: "WARN" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.issues.some((i) => i.message.includes("inconsistent"))).toBe(true);
  });
});

describe("analyzeLoggers — level distribution", () => {
  it("should count configured log levels", () => {
    const json = JSON.stringify({
      loggers: {
        ROOT: { configuredLevel: "INFO", effectiveLevel: "INFO" },
        "com.example.a": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "com.example.b": { configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
        "com.example.c": { configuredLevel: "WARN", effectiveLevel: "WARN" },
      },
    });
    const result = analyzeLoggers(json);
    expect(result.levels["INFO"]).toBe(1);
    expect(result.levels["DEBUG"]).toBe(2);
    expect(result.levels["WARN"]).toBe(1);
  });
});
