/**
 * Spring Boot loggers analyzer.
 *
 * Parses the /loggers actuator endpoint JSON.
 * Detects:
 * - DEBUG/TRACE levels in production (performance & security risk)
 * - Inconsistent log levels across related packages
 * - Missing log levels for key frameworks (Spring, Hibernate, etc.)
 * - ROOT logger misconfiguration
 */

export interface LoggerEntry {
  name: string;
  configuredLevel: string | null;
  effectiveLevel: string;
}

export interface LoggerReport {
  loggers: LoggerEntry[];
  levels: Record<string, number>; // level → count of configured loggers
  issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string }>;
  recommendations: string[];
}

const KEY_FRAMEWORKS = [
  "org.springframework",
  "org.hibernate",
  "org.apache",
  "com.zaxxer.hikari",
  "io.micrometer",
];

const VERBOSE_LEVELS = ["DEBUG", "TRACE"];

export function analyzeLoggers(json: string): LoggerReport {
  const issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string }> = [];
  const recommendations: string[] = [];
  const loggers: LoggerEntry[] = [];
  const levels: Record<string, number> = {};

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    issues.push({
      severity: "CRITICAL",
      message: "Invalid JSON — could not parse /loggers endpoint response.",
    });
    return { loggers, levels, issues, recommendations };
  }

  const rawLoggers = (data as Record<string, unknown>)?.loggers as
    | Record<string, Record<string, string | null>>
    | undefined;

  if (!rawLoggers || Object.keys(rawLoggers).length === 0) {
    issues.push({
      severity: "WARNING",
      message: "No loggers found in response. Ensure /loggers endpoint is exposed.",
    });
    return { loggers, levels, issues, recommendations };
  }

  // Parse all loggers
  for (const [name, config] of Object.entries(rawLoggers)) {
    const configuredLevel = config?.configuredLevel ?? null;
    const effectiveLevel = config?.effectiveLevel ?? "UNKNOWN";
    loggers.push({ name, configuredLevel, effectiveLevel });

    if (configuredLevel) {
      levels[configuredLevel] = (levels[configuredLevel] || 0) + 1;
    }
  }

  // Check ROOT logger
  const root = loggers.find((l) => l.name === "ROOT");
  if (root) {
    if (root.effectiveLevel === "DEBUG" || root.effectiveLevel === "TRACE") {
      issues.push({
        severity: "CRITICAL",
        message: `ROOT logger is set to ${root.effectiveLevel} — this will flood logs and degrade performance in production.`,
      });
      recommendations.push(
        "Set ROOT logger to INFO or WARN for production: POST /actuator/loggers/ROOT {\"configuredLevel\":\"INFO\"}",
      );
    }
  }

  // Find explicitly configured verbose loggers
  const verboseLoggers = loggers.filter(
    (l) => l.configuredLevel && VERBOSE_LEVELS.includes(l.configuredLevel),
  );

  if (verboseLoggers.length > 0) {
    const topPackages = verboseLoggers
      .filter((l) => l.name !== "ROOT")
      .slice(0, 10);

    if (topPackages.length > 0) {
      issues.push({
        severity: "WARNING",
        message: `${topPackages.length} logger(s) explicitly set to DEBUG/TRACE: ${topPackages.map((l) => l.name).join(", ")}`,
      });
      recommendations.push(
        "Review DEBUG/TRACE loggers — verbose logging in production causes I/O overhead and may expose sensitive data.",
      );
    }
  }

  // Check for many verbose loggers (likely left from debugging)
  if (verboseLoggers.length > 5) {
    issues.push({
      severity: "WARNING",
      message: `${verboseLoggers.length} loggers at DEBUG/TRACE — likely leftover debug configuration.`,
    });
  }

  // Check for inconsistent levels across related packages
  detectInconsistentLevels(loggers, issues);

  // Check for key framework loggers
  for (const framework of KEY_FRAMEWORKS) {
    const frameworkLoggers = loggers.filter((l) => l.name.startsWith(framework));
    if (frameworkLoggers.length === 0) {
      // Not an issue — framework may not be in use
      continue;
    }

    const verbose = frameworkLoggers.filter(
      (l) => l.configuredLevel && VERBOSE_LEVELS.includes(l.configuredLevel),
    );
    if (verbose.length > 0) {
      issues.push({
        severity: "WARNING",
        message: `Framework "${framework}" has ${verbose.length} verbose logger(s) — this can generate massive log output.`,
      });
    }
  }

  // Summary recommendation
  if (issues.length === 0) {
    recommendations.push(
      `${loggers.length} loggers configured. No issues detected. Logger levels appear production-appropriate.`,
    );
  }

  return { loggers, levels, issues, recommendations };
}

function detectInconsistentLevels(
  loggers: LoggerEntry[],
  issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string }>,
): void {
  // Group by top-level package (2 segments: com.example)
  const packageGroups = new Map<string, LoggerEntry[]>();

  for (const logger of loggers) {
    if (!logger.configuredLevel || logger.name === "ROOT") continue;
    const parts = logger.name.split(".");
    if (parts.length < 2) continue;
    const pkg = parts.slice(0, 2).join(".");
    const group = packageGroups.get(pkg) || [];
    group.push(logger);
    packageGroups.set(pkg, group);
  }

  for (const [pkg, group] of packageGroups) {
    if (group.length < 2) continue;
    const uniqueLevels = new Set(group.map((l) => l.configuredLevel));
    if (uniqueLevels.size > 1) {
      issues.push({
        severity: "INFO",
        message: `Package "${pkg}" has inconsistent log levels: ${[...uniqueLevels].join(", ")}. This may be intentional but worth reviewing.`,
      });
    }
  }
}
