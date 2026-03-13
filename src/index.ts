#!/usr/bin/env node

/**
 * MCP Spring Boot Actuator — MCP server for Spring Boot application diagnostics.
 *
 * Tools:
 *   analyze_health   — Parse and diagnose /health endpoint response
 *   analyze_metrics  — Analyze JVM, HTTP, and DB pool metrics
 *   analyze_env      — Detect exposed secrets and risky configurations
 *   analyze_beans    — Detect circular dependencies and scope mismatches
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseHealth } from "./parsers/health.js";
import { analyzeMetrics } from "./analyzers/metrics.js";
import { analyzeEnv } from "./analyzers/env-risk.js";
import { analyzeBeans } from "./analyzers/beans.js";
import { analyzeStartup } from "./analyzers/startup.js";
import { analyzeCaches } from "./analyzers/caches.js";
import { analyzeLoggers } from "./analyzers/loggers.js";
import { validateLicense, formatUpgradePrompt } from "./license.js";
import { formatSeveritySummary } from "./format.js";

// License check (reads MCP_LICENSE_KEY env var once at startup)
const license = validateLicense(process.env.MCP_LICENSE_KEY, "spring-boot-actuator");

// Handle --help
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`mcp-spring-boot-actuator v0.1.1 — MCP server for Spring Boot Actuator diagnostics

Usage:
  mcp-spring-boot-actuator [options]

Options:
  --help, -h   Show this help message

Tools provided:
  analyze_health   Parse and diagnose /health endpoint response
  analyze_metrics  Analyze JVM, HTTP, and DB pool metrics
  analyze_env      Detect exposed secrets and risky configurations
  analyze_beans    Detect circular dependencies and scope mismatches
  analyze_startup  Parse /startup endpoint for bean init times
  analyze_caches   Analyze /caches endpoint for cache health
  analyze_loggers  Detect verbose logging and misconfigurations`);
  process.exit(0);
}

const server = new McpServer({
  name: "mcp-spring-boot-actuator",
  version: "0.1.0",
});

// Tool 1: analyze_health
server.tool(
  "analyze_health",
  "Analyze a Spring Boot Actuator /health endpoint response. Diagnoses unhealthy components and provides recommendations.",
  {
    json: z.string().describe("JSON response from the /health endpoint (curl http://localhost:8080/actuator/health)"),
  },
  async ({ json }) => {
    const report = parseHealth(json);

    let output = `## Health Analysis\n\n`;
    output += `**Overall Status**: ${report.overallStatus}\n`;
    output += `**Components**: ${report.components.length}\n\n`;

    if (report.components.length > 0) {
      output += "### Component Status\n\n";
      output += "| Component | Status | Details |\n|-----------|--------|--------|\n";
      for (const comp of report.components) {
        const details = Object.entries(comp.details).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ");
        output += `| ${comp.name} | ${comp.status} | ${details || "-"} |\n`;
      }
      output += "\n";
    }

    if (report.issues.length > 0) {
      output += "### Issues\n\n";
      for (const issue of report.issues) {
        output += `**${issue.severity}** [${issue.component}]: ${issue.message}\n\n`;
      }
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    output += formatSeveritySummary(report.issues);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 2: analyze_metrics
server.tool(
  "analyze_metrics",
  "Analyze Spring Boot Actuator metrics data. Detects JVM memory pressure, high error rates, connection pool exhaustion, and GC issues.",
  {
    json: z.string().describe("JSON object with metric names as keys and values (e.g., from /metrics endpoints)"),
  },
  async ({ json }) => {
    const report = analyzeMetrics(json);

    let output = `## Metrics Analysis\n\n`;

    if (report.jvm) {
      output += "### JVM\n\n";
      output += `| Metric | Value |\n|--------|-------|\n`;
      output += `| Heap Used | ${formatBytes(report.jvm.heapUsed)} |\n`;
      output += `| Heap Max | ${formatBytes(report.jvm.heapMax)} |\n`;
      output += `| Heap Utilization | ${(report.jvm.heapUtilization * 100).toFixed(1)}% |\n`;
      output += `| Thread Count | ${report.jvm.threadCount} |\n`;
      output += `| Thread Peak | ${report.jvm.threadPeak} |\n`;
      output += `| GC Pauses | ${report.jvm.gcPauseCount} (${report.jvm.gcPauseTotal.toFixed(1)}s total) |\n`;
      output += `| Loaded Classes | ${report.jvm.loadedClasses} |\n\n`;
    }

    if (report.http) {
      output += "### HTTP\n\n";
      output += `| Metric | Value |\n|--------|-------|\n`;
      output += `| Total Requests | ${report.http.totalRequests} |\n`;
      output += `| Error Rate | ${(report.http.errorRate * 100).toFixed(1)}% |\n`;
      output += `| Max Latency | ${report.http.maxLatency}ms |\n\n`;
    }

    if (report.issues.length > 0) {
      output += "### Issues\n\n";
      for (const issue of report.issues) {
        output += `**${issue.severity}** [${issue.category}]: ${issue.message}\n\n`;
      }
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    if (!report.jvm && !report.http && report.issues.length === 0) {
      output += "No recognized metrics found. Provide metrics in the format: `{\"jvm.memory.used\": 1234567, ...}`\n";
    }

    output += formatSeveritySummary(report.issues);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 3: analyze_env
server.tool(
  "analyze_env",
  "Analyze Spring Boot Actuator /env endpoint response. Detects exposed secrets, risky configurations, and missing production settings.",
  {
    json: z.string().describe("JSON response from the /env endpoint (curl http://localhost:8080/actuator/env)"),
  },
  async ({ json }) => {
    const report = analyzeEnv(json);

    let output = `## Environment Analysis\n\n`;
    output += `**Active Profiles**: ${report.activeProfiles.length > 0 ? report.activeProfiles.join(", ") : "none"}\n`;
    output += `**Property Sources**: ${report.propertySources.length}\n\n`;

    if (report.risks.length > 0) {
      output += "### Risks\n\n";
      const critical = report.risks.filter(r => r.severity === "CRITICAL");
      const warning = report.risks.filter(r => r.severity === "WARNING");
      const info = report.risks.filter(r => r.severity === "INFO");

      for (const group of [critical, warning, info]) {
        for (const risk of group) {
          output += `**${risk.severity}** \`${risk.property}\`: ${risk.message}\n`;
          output += `> ${risk.recommendation}\n\n`;
        }
      }
    } else {
      output += "### No risks detected.\n\n";
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    output += formatSeveritySummary(report.risks);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 4: analyze_beans
server.tool(
  "analyze_beans",
  "Analyze Spring Boot Actuator /beans endpoint response. Detects circular dependencies, scope mismatches, and bean architecture issues.",
  {
    json: z.string().describe("JSON response from the /beans endpoint (curl http://localhost:8080/actuator/beans)"),
  },
  async ({ json }) => {
    if (!license.isPro) {
      return {
        content: [{
          type: "text" as const,
          text: formatUpgradePrompt("analyze_beans",
            "Bean architecture analysis with:\n" +
            "- Circular dependency detection\n" +
            "- Scope mismatch identification\n" +
            "- Bean dependency graph analysis\n" +
            "- Context hierarchy issues"),
        }],
      };
    }
    const report = analyzeBeans(json);

    let output = `## Bean Analysis\n\n`;
    output += `**Total Beans**: ${report.totalBeans}\n`;
    if (report.contexts.length > 0) {
      output += `**Contexts**: ${report.contexts.join(", ")}\n`;
    }
    output += "\n";

    if (report.issues.length > 0) {
      output += "### Issues\n\n";
      for (const issue of report.issues) {
        output += `**${issue.severity}**: ${issue.message}\n`;
        if (issue.beans.length > 0) {
          output += `> Beans: ${issue.beans.join(", ")}\n`;
        }
        output += "\n";
      }
    } else {
      output += "### No issues detected.\n\n";
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    output += formatSeveritySummary(report.issues);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 5: analyze_startup
server.tool(
  "analyze_startup",
  "Analyze Spring Boot Actuator /startup endpoint (Spring Boot 3.2+). Detects slow bean initialization, heavy auto-configurations, and startup bottlenecks.",
  {
    json: z.string().describe("JSON response from the /startup endpoint (curl http://localhost:8080/actuator/startup)"),
  },
  async ({ json }) => {
    if (!license.isPro) {
      return {
        content: [{
          type: "text" as const,
          text: formatUpgradePrompt("analyze_startup",
            "Startup performance analysis with:\n" +
            "- Slow bean initialization detection\n" +
            "- Heavy auto-configuration identification\n" +
            "- Startup bottleneck analysis\n" +
            "- Bean init time ranking"),
        }],
      };
    }
    const report = analyzeStartup(json);

    let output = `## Startup Analysis\n\n`;
    output += `**Total Startup Time**: ${(report.totalDurationMs / 1000).toFixed(1)}s\n`;
    output += `**Startup Steps**: ${report.steps.length}\n`;
    output += `**Slow Steps**: ${report.slowSteps.length}\n\n`;

    if (report.slowSteps.length > 0) {
      output += "### Slowest Steps\n\n";
      output += "| Step | Duration | Bean |\n|------|----------|------|\n";
      for (const step of report.slowSteps.slice(0, 15)) {
        const bean = step.tags.beanName || "-";
        output += `| ${step.name} | ${(step.durationMs / 1000).toFixed(2)}s | ${bean} |\n`;
      }
      output += "\n";
    }

    if (report.issues.length > 0) {
      output += "### Issues\n\n";
      for (const issue of report.issues) {
        output += `**${issue.severity}**: ${issue.message}\n\n`;
      }
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    output += formatSeveritySummary(report.issues);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 6: analyze_caches
server.tool(
  "analyze_caches",
  "Analyze Spring Boot Actuator /caches endpoint. Lists registered caches, detects unbounded caches (memory leak risk), and identifies cache configuration issues.",
  {
    json: z.string().describe("JSON response from the /caches endpoint (curl http://localhost:8080/actuator/caches)"),
  },
  async ({ json }) => {
    if (!license.isPro) {
      return {
        content: [{
          type: "text" as const,
          text: formatUpgradePrompt("analyze_caches",
            "Cache health analysis with:\n" +
            "- Unbounded cache detection (memory leak risk)\n" +
            "- Cache configuration audit\n" +
            "- Cache manager inventory\n" +
            "- Optimization recommendations"),
        }],
      };
    }
    const report = analyzeCaches(json);

    let output = `## Cache Analysis\n\n`;
    output += `**Registered Caches**: ${report.caches.length}\n\n`;

    if (report.caches.length > 0) {
      output += "### Cache Registry\n\n";
      output += "| Cache | Manager | Implementation |\n|-------|---------|----------------|\n";
      for (const cache of report.caches) {
        output += `| ${cache.name} | ${cache.cacheManager} | ${cache.target} |\n`;
      }
      output += "\n";
    }

    if (report.issues.length > 0) {
      output += "### Issues\n\n";
      for (const issue of report.issues) {
        output += `**${issue.severity}**${issue.cache ? ` [${issue.cache}]` : ""}: ${issue.message}\n\n`;
      }
    }

    if (report.recommendations.length > 0) {
      output += "### Recommendations\n\n";
      for (const rec of report.recommendations) {
        output += `- ${rec}\n`;
      }
    }

    output += formatSeveritySummary(report.issues);

    return { content: [{ type: "text" as const, text: output }] };
  }
);

// Tool 7: analyze_loggers
server.tool(
  "analyze_loggers",
  "Analyze Spring Boot /loggers endpoint response. Detects DEBUG/TRACE in production, inconsistent log levels across packages, and verbose framework logging.",
  {
    json: z.string().describe("JSON response from /loggers endpoint (curl http://localhost:8080/actuator/loggers)"),
  },
  async ({ json }) => {
    try {
      const report = analyzeLoggers(json);

      let output = `## Logger Analysis\n\n`;
      output += `**Total Loggers**: ${report.loggers.length}\n\n`;

      // Level distribution
      if (Object.keys(report.levels).length > 0) {
        output += "### Configured Log Levels\n\n";
        output += "| Level | Count |\n|-------|-------|\n";
        for (const [level, count] of Object.entries(report.levels).sort((a, b) => b[1] - a[1])) {
          output += `| ${level} | ${count} |\n`;
        }
        output += "\n";
      }

      if (report.issues.length > 0) {
        output += "### Issues\n\n";
        for (const issue of report.issues) {
          output += `**${issue.severity}**: ${issue.message}\n\n`;
        }
      }

      if (report.recommendations.length > 0) {
        output += "### Recommendations\n\n";
        for (const rec of report.recommendations) {
          output += `- ${rec}\n`;
        }
      }

      output += formatSeveritySummary(report.issues);

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Error analyzing loggers: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }
  }
);

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
