import { describe, it, expect } from "vitest";
import { parseHealth } from "../src/parsers/health.js";
import { analyzeMetrics } from "../src/analyzers/metrics.js";
import { analyzeEnv } from "../src/analyzers/env-risk.js";
import { analyzeBeans } from "../src/analyzers/beans.js";

const HTML_401 = `<!DOCTYPE html>
<html><body>
<h1>Whitelabel Error Page</h1>
<p>This application has no explicit mapping for /error, so you are seeing this as a fallback.</p>
<div>There was an unexpected error (type=Unauthorized, status=401).</div>
</body></html>`;

const HTML_403 = `<html><body><h1>403 Forbidden</h1><p>Access Denied</p></body></html>`;

const HTML_500 = `<!DOCTYPE html>
<html><head><title>500 Internal Server Error</title></head>
<body><h1>Internal Server Error</h1></body></html>`;

const PLAIN_TEXT = "Service Unavailable";

describe("parseHealth — non-JSON responses", () => {
  it("should handle HTML 401 Unauthorized page", () => {
    const result = parseHealth(HTML_401);
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("CRITICAL");
    expect(result.issues[0].message).toContain("Invalid JSON");
    expect(result.recommendations).toHaveLength(1);
  });

  it("should handle HTML 403 Forbidden page", () => {
    const result = parseHealth(HTML_403);
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.issues[0].message).toContain("Invalid JSON");
  });

  it("should handle HTML 500 error page", () => {
    const result = parseHealth(HTML_500);
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.components).toHaveLength(0);
  });

  it("should handle plain text response", () => {
    const result = parseHealth(PLAIN_TEXT);
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.issues[0].severity).toBe("CRITICAL");
  });

  it("should handle empty string", () => {
    const result = parseHealth("");
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.issues[0].message).toContain("Invalid JSON");
  });

  it("should handle Spring Security redirect HTML", () => {
    const html = `<html><head><meta http-equiv="refresh" content="0;url=/login"/></head><body>Redirecting to /login</body></html>`;
    const result = parseHealth(html);
    expect(result.overallStatus).toBe("UNKNOWN");
    expect(result.issues).toHaveLength(1);
  });
});

describe("analyzeMetrics — non-JSON responses", () => {
  it("should handle HTML 401 page", () => {
    const result = analyzeMetrics(HTML_401);
    expect(result.jvm).toBeNull();
    expect(result.http).toBeNull();
    expect(result.issues[0].message).toContain("Invalid JSON");
  });

  it("should handle empty string", () => {
    const result = analyzeMetrics("");
    expect(result.issues[0].severity).toBe("CRITICAL");
  });

  it("should handle plain text", () => {
    const result = analyzeMetrics("Not Found");
    expect(result.issues[0].message).toContain("Invalid JSON");
  });
});

describe("analyzeEnv — non-JSON responses", () => {
  it("should handle HTML 401 page", () => {
    const result = analyzeEnv(HTML_401);
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].message).toContain("Invalid JSON");
  });

  it("should handle empty string", () => {
    const result = analyzeEnv("");
    expect(result.risks[0].severity).toBe("CRITICAL");
  });
});

describe("analyzeBeans — non-JSON responses", () => {
  it("should handle HTML 403 page", () => {
    const result = analyzeBeans(HTML_403);
    expect(result.issues[0].message).toContain("Invalid JSON");
  });

  it("should handle empty string", () => {
    const result = analyzeBeans("");
    expect(result.issues[0].severity).toBe("CRITICAL");
  });
});
