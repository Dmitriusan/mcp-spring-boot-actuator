# Changelog

All notable changes to MCP Spring Boot Actuator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-03-10

### Added
- MCP server for Spring Boot Actuator analysis
- 6 analytical tools:
  - `analyze_health` — parse /health endpoint, detect component failures, disk space warnings
  - `analyze_metrics` — JVM memory, GC pauses, HTTP request stats, HikariCP pool analysis
  - `analyze_env` — detect exposed secrets, missing profiles, debug mode in production
  - `analyze_beans` — bean dependency analysis, circular dependency detection, scope issues
  - `analyze_startup` — startup timing analysis, slow bean detection, initialization bottlenecks
  - `analyze_caches` — cache hit/miss ratios, eviction rates, sizing recommendations
- Endpoint-level HTTP metrics breakdown (http.server.requests.by.uri)
- Spring Boot measurement format support (measurements array with statistic/value)
- Non-JSON response handling with clear error messages
- npm-ready packaging with shebang and bin entry
