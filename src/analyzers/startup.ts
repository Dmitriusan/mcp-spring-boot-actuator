/**
 * Spring Boot startup analyzer.
 *
 * Parses the /startup actuator endpoint (Spring Boot 3.2+).
 * Detects:
 * - Slow bean initialization
 * - Heavy auto-configurations
 * - Total startup time breakdown
 */

export interface StartupStep {
  name: string;
  id: number;
  parentId: number | null;
  durationMs: number;
  tags: Record<string, string>;
}

export interface StartupReport {
  totalDurationMs: number;
  steps: StartupStep[];
  slowSteps: StartupStep[];
  issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string }>;
  recommendations: string[];
}

export function analyzeStartup(json: string): StartupReport {
  const issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string }> = [];
  const recommendations: string[] = [];

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    issues.push({
      severity: "CRITICAL",
      message: "Invalid JSON — could not parse startup endpoint response.",
    });
    return { totalDurationMs: 0, steps: [], slowSteps: [], issues, recommendations };
  }

  const timeline = (data as Record<string, unknown>)?.timeline as Record<string, unknown> | undefined;
  if (!timeline) {
    issues.push({
      severity: "WARNING",
      message: "No timeline data found. Ensure the /startup endpoint is enabled (management.endpoint.startup.enabled=true) and the application has been started with buffering.",
    });
    return { totalDurationMs: 0, steps: [], slowSteps: [], issues, recommendations };
  }

  const startupTime = timeline.startupTime as Record<string, unknown> | undefined;
  const totalDurationMs = typeof startupTime?.totalTime === "string"
    ? parseDuration(startupTime.totalTime as string)
    : typeof startupTime?.totalTime === "number"
      ? startupTime.totalTime as number
      : 0;

  const events = (timeline.events || []) as Array<Record<string, unknown>>;
  const steps: StartupStep[] = [];

  for (const event of events) {
    const startupStep = event.startupStep as Record<string, unknown> | undefined;
    if (!startupStep) continue;

    const duration = typeof event.duration === "string"
      ? parseDuration(event.duration as string)
      : typeof event.duration === "number"
        ? (event.duration as number)
        : 0;

    const tags: Record<string, string> = {};
    const tagArray = (startupStep.tags || []) as Array<Record<string, string>>;
    for (const tag of tagArray) {
      if (tag.key && tag.value) {
        tags[tag.key] = tag.value;
      }
    }

    steps.push({
      name: (startupStep.name as string) || "unknown",
      id: (startupStep.id as number) || 0,
      parentId: (startupStep.parentId as number) ?? null,
      durationMs: duration,
      tags,
    });
  }

  // Sort by duration (slowest first)
  steps.sort((a, b) => b.durationMs - a.durationMs);

  // Find slow steps (> 500ms or top 10% of total)
  const slowThreshold = Math.max(500, totalDurationMs * 0.05);
  const slowSteps = steps.filter(s => s.durationMs >= slowThreshold);

  // Detect issues
  if (totalDurationMs > 30000) {
    issues.push({
      severity: "CRITICAL",
      message: `Application startup took ${(totalDurationMs / 1000).toFixed(1)}s — exceeds 30s threshold.`,
    });
    recommendations.push("Consider using Spring Boot lazy initialization: spring.main.lazy-initialization=true");
  } else if (totalDurationMs > 15000) {
    issues.push({
      severity: "WARNING",
      message: `Application startup took ${(totalDurationMs / 1000).toFixed(1)}s — consider optimization.`,
    });
  }

  // Detect heavy auto-configurations
  const autoConfigSteps = steps.filter(s =>
    s.name.includes("auto-configuration") || s.tags.beanName?.includes("AutoConfiguration")
  );
  if (autoConfigSteps.length > 0) {
    const totalAutoConfigMs = autoConfigSteps.reduce((sum, s) => sum + s.durationMs, 0);
    if (totalAutoConfigMs > totalDurationMs * 0.3 && totalDurationMs > 0) {
      issues.push({
        severity: "WARNING",
        message: `Auto-configuration consumed ${(totalAutoConfigMs / 1000).toFixed(1)}s (${((totalAutoConfigMs / totalDurationMs) * 100).toFixed(0)}% of startup).`,
      });
      recommendations.push("Exclude unnecessary auto-configurations with @SpringBootApplication(exclude = {...})");
    }
  }

  // Detect slow bean initializations
  const slowBeans = steps.filter(s =>
    s.durationMs > 2000 && (s.name.includes("instantiate") || s.name.includes("init") || s.tags.beanName)
  );
  for (const bean of slowBeans.slice(0, 5)) {
    const beanName = bean.tags.beanName || bean.name;
    issues.push({
      severity: "WARNING",
      message: `Bean "${beanName}" took ${(bean.durationMs / 1000).toFixed(1)}s to initialize.`,
    });
  }

  if (slowBeans.length > 3) {
    recommendations.push("Consider making slow beans @Lazy or deferring initialization to first use.");
  }

  if (issues.length === 0) {
    recommendations.push(`Startup looks healthy (${(totalDurationMs / 1000).toFixed(1)}s).`);
  }

  return { totalDurationMs, steps, slowSteps, issues, recommendations };
}

/**
 * Parse ISO 8601 duration or Spring Boot format (e.g., "PT1.234S", "1234ms", "1.234s").
 */
function parseDuration(value: string): number {
  // PT format: PT1.234S
  const ptMatch = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/i);
  if (ptMatch) {
    const hours = parseInt(ptMatch[1] || "0", 10);
    const minutes = parseInt(ptMatch[2] || "0", 10);
    const seconds = parseFloat(ptMatch[3] || "0");
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Milliseconds: "1234ms"
  const msMatch = value.match(/([\d.]+)\s*ms/i);
  if (msMatch) return parseFloat(msMatch[1]);

  // Seconds: "1.234s"
  const sMatch = value.match(/([\d.]+)\s*s/i);
  if (sMatch) return parseFloat(sMatch[1]) * 1000;

  // Plain number (assume ms)
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}
