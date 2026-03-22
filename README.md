[![npm version](https://img.shields.io/npm/v/mcp-spring-boot-actuator)](https://www.npmjs.com/package/mcp-spring-boot-actuator)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

# MCP Spring Boot Actuator

An MCP server that analyzes Spring Boot Actuator endpoints — health, metrics, environment, beans, startup, and caches. Detects issues, security risks, and provides actionable recommendations.

## Why This Tool?

There is **no other MCP server** that analyzes Spring Boot Actuator endpoints. This is the only tool that lets your AI assistant understand your Spring Boot application's health, performance, configuration, and startup behavior through actuator data.

7 analytical tools turn raw actuator JSON into actionable diagnostics — health checks, JVM metrics analysis, security risk detection in environment/beans, startup bottleneck identification, and cache efficiency analysis.

## Pro Tier

**Generate exportable diagnostic reports (HTML + PDF)** with a Pro license key.

- Full JVM thread dump analysis report with actionable recommendations
- PDF export for sharing with your team
- Priority support

<!-- TODO: replace placeholder Stripe Payment Link once STRIPE_SECRET_KEY is configured -->
**$9.99/month** — [Get Pro License](https://buy.stripe.com/PLACEHOLDER)

Pro license key activates the `generate_report` MCP tool in mcp-jvm-diagnostics.

## Tools (7)

### `analyze_health`

Parse and diagnose the `/health` endpoint response. Detects unhealthy components (database, Redis, Kafka, Elasticsearch, disk space) with component-specific recommendations.

```
curl http://localhost:8080/actuator/health | jq '.' > health.json
```

**Detects:**
- DOWN/OUT_OF_SERVICE components
- Low disk space warnings (< 15% free)
- Nested component health (e.g., primary/secondary databases)
- Restricted health endpoints (no `show-details`)

### `analyze_metrics`

Analyze JVM, HTTP, and database pool metrics from `/metrics` endpoints.

```
# Collect metrics into a single JSON object:
{
  "jvm.memory.used": 800000000,
  "jvm.memory.max": 1000000000,
  "jvm.threads.live": 150,
  "jvm.gc.pause.count": 500,
  "jvm.gc.pause.total": 8.5,
  "http.server.requests.count": 10000,
  "http.server.requests.error.count": 50,
  "hikaricp.connections.active": 8,
  "hikaricp.connections.max": 10
}
```

**Detects:**
- Heap utilization >= 90% (CRITICAL) or > 75% (WARNING)
- High thread count (> 500)
- Long GC pauses (avg > 200ms)
- HTTP error rate > 10% (CRITICAL) or > 1% (WARNING)
- Connection pool exhaustion >= 90% (CRITICAL)
- Pending connection requests

Supports both flat metric values and Spring Boot measurement format (`{ measurements: [{ statistic: "VALUE", value: N }] }`).

### `analyze_env`

Analyze the `/env` endpoint for security risks and misconfigurations.

```
curl http://localhost:8080/actuator/env | jq '.' > env.json
```

**Detects:**
- Exposed secrets (passwords, API keys, tokens not masked with `******`)
- Risky production configs: `ddl-auto: create-drop`, H2 console enabled, `show-sql: true`
- DevTools enabled in production
- All actuator endpoints exposed (`management.endpoints.web.exposure.include=*`)
- Missing Spring profiles (no active profiles set)

### `analyze_beans`

Analyze the `/beans` endpoint for architectural issues.

```
curl http://localhost:8080/actuator/beans | jq '.' > beans.json
```

**Detects:**
- Circular dependencies (A → B → A)
- Singleton beans depending on prototype-scoped beans (scope mismatch)
- Beans with > 10 dependencies (God objects)
- Large bean counts (> 500)
- Multiple application contexts

### `analyze_startup`

Analyze the `/startup` actuator endpoint (Spring Boot 3.2+). Parses the startup timeline to detect slow bean initialization and heavy auto-configurations.

```
curl -X POST http://localhost:8080/actuator/startup | jq '.' > startup.json
```

**Parameters:**
- `json` — The `/startup` endpoint JSON response

**Detects:**
- Slow startup (> 30s CRITICAL, > 15s WARNING)
- Heavy auto-configurations consuming > 30% of startup time
- Slow bean initialization (> 2s per bean)
- Top slowest steps ranked by duration

### `analyze_caches`

Analyze the `/caches` actuator endpoint. Lists registered caches and detects configuration issues.

```
curl http://localhost:8080/actuator/caches | jq '.' > caches.json
```

**Parameters:**
- `json` — The `/caches` endpoint JSON response

**Detects:**
- Unbounded `ConcurrentMapCache` usage (no eviction, will grow indefinitely)
- Too many caches (> 20, memory overhead)
- Missing cache managers (no Spring Cache configured)
- Empty cache registrations

### `analyze_loggers`

Analyze the `/loggers` actuator endpoint. Detects verbose logging configurations that impact performance and security in production.

```
curl http://localhost:8080/actuator/loggers | jq '.' > loggers.json
```

**Parameters:**
- `json` — The `/loggers` endpoint JSON response

**Detects:**
- ROOT logger set to DEBUG/TRACE (floods logs, degrades performance)
- Explicitly configured DEBUG/TRACE loggers (likely leftover from debugging)
- Verbose framework logging (Spring, Hibernate, HikariCP, Micrometer, Apache)
- Inconsistent log levels across related packages
- More than 5 verbose loggers (signs of leftover debug configuration)

## Installation

```bash
npm install -g mcp-spring-boot-actuator
```

Or use directly with npx:

```bash
npx mcp-spring-boot-actuator
```

## Configuration

### Claude Desktop

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "spring-boot-actuator": {
      "command": "npx",
      "args": ["-y", "mcp-spring-boot-actuator"]
    }
  }
}
```

### Quick Demo

Once configured, try these prompts in Claude:

1. **"Check the health of my Spring Boot app: [paste /actuator/health JSON]"** — Detects DOWN components, low disk space, and provides component-specific recommendations
2. **"Are there any security risks in my config? [paste /actuator/env JSON]"** — Finds exposed secrets, risky settings like `ddl-auto: create-drop`, and over-exposed endpoints
3. **"How is my app performing? [paste JVM/HTTP metrics]"** — Analyzes heap usage, GC pressure, HTTP error rates, and connection pool utilization
- "Why is my app starting so slowly?" (paste `/actuator/startup` JSON)
- "Are my caches configured properly?" (paste `/actuator/caches` JSON)

## Requirements

- Node.js 18+
- Spring Boot application with Actuator endpoints enabled

## Part of the MCP Java Backend Suite

- [mcp-db-analyzer](https://www.npmjs.com/package/mcp-db-analyzer) — PostgreSQL/MySQL/SQLite schema analysis
- [mcp-jvm-diagnostics](https://www.npmjs.com/package/mcp-jvm-diagnostics) — Thread dump and GC log analysis
- [mcp-redis-diagnostics](https://www.npmjs.com/package/mcp-redis-diagnostics) — Redis memory, slowlog, and client diagnostics
- [mcp-migration-advisor](https://www.npmjs.com/package/mcp-migration-advisor) — Flyway/Liquibase migration risk analysis

## Limitations & Known Issues

- **Actuator endpoints must be exposed**: Spring Boot secures actuator endpoints by default. You must explicitly expose endpoints via `management.endpoints.web.exposure.include`.
- **Startup analysis**: Requires Spring Boot 3.2+ with `management.endpoint.startup.enabled=true`. Older versions don't provide startup timing data.
- **Single instance**: Analyzes one application instance at a time. For clustered applications, point to each instance separately.
- **Metric accumulation**: Some metrics (HTTP request counts, error rates) require traffic to accumulate data. A freshly started app may show zeros.
- **Environment masking**: Spring Boot masks sensitive properties by default. The `analyze_env` tool sees masked values (e.g., `******`) and cannot detect actual credential exposure in masked properties.
- **Custom health indicators**: The tool recognizes standard health indicator patterns. Custom health indicators with non-standard status values may not trigger specific recommendations.
- **Cache analysis**: Supports ConcurrentMapCache, Caffeine, Redis, and EhCache. Other cache providers may show limited analysis.
- **Non-JSON responses**: Handles HTML error pages (401, 403, 500) gracefully with "Invalid JSON" warnings, but cannot extract useful data from them.
- **Circular dependency depth**: Detects cycles of any length, including multi-hop chains (A→B→C→A).

## License

MIT
