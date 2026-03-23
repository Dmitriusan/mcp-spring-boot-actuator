/**
 * Spring Boot Actuator metrics analyzer.
 *
 * Analyzes JVM metrics, HTTP request metrics, and database pool metrics
 * from the /metrics endpoint data.
 */

export interface MetricValue {
  name: string;
  value: number;
  unit?: string;
}

export interface MetricsReport {
  jvm: JvmMetrics | null;
  http: HttpMetrics | null;
  issues: MetricIssue[];
  recommendations: string[];
}

export interface JvmMetrics {
  heapUsed: number;
  heapMax: number;
  heapUtilization: number;
  nonHeapUsed: number;
  threadCount: number;
  threadDaemon: number;
  threadPeak: number;
  gcPauseCount: number;
  gcPauseTotal: number;
  loadedClasses: number;
}

export interface HttpMetrics {
  totalRequests: number;
  meanLatency: number;
  maxLatency: number;
  errorRate: number;
  endpoints: EndpointMetric[];
}

export interface EndpointMetric {
  uri: string;
  method: string;
  count: number;
  meanMs: number;
  maxMs: number;
  errorCount: number;
}

export interface MetricIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: string;
  message: string;
}

/**
 * Analyze a collection of metrics from the /metrics endpoint.
 * Input is a map of metric name → metric value (flat structure).
 */
export function analyzeMetrics(json: string): MetricsReport {
  let metrics: Record<string, unknown>;
  try {
    metrics = JSON.parse(json);
  } catch {
    return {
      jvm: null,
      http: null,
      issues: [{ severity: "CRITICAL", category: "parser", message: "Invalid JSON in metrics data" }],
      recommendations: [],
    };
  }

  const issues: MetricIssue[] = [];
  const recommendations: string[] = [];

  const jvm = extractJvmMetrics(metrics, issues, recommendations);
  const http = extractHttpMetrics(metrics, issues, recommendations);

  // Check DB pool metrics
  analyzeDbPool(metrics, issues, recommendations);

  return { jvm, http, issues, recommendations };
}

function getMetric(metrics: Record<string, unknown>, name: string): number | null {
  const val = metrics[name];
  if (typeof val === "number") return val;
  if (typeof val === "object" && val !== null) {
    const m = val as Record<string, unknown>;
    if (typeof m.value === "number") return m.value;
    // Spring Boot format: { measurements: [{ statistic: "VALUE", value: N }] }
    if (Array.isArray(m.measurements)) {
      const valMeasure = m.measurements.find(
        (x: unknown) => (x as Record<string, unknown>).statistic === "VALUE" || (x as Record<string, unknown>).statistic === "COUNT"
      );
      if (valMeasure && typeof (valMeasure as Record<string, unknown>).value === "number") {
        return (valMeasure as Record<string, unknown>).value as number;
      }
    }
  }
  return null;
}

function extractJvmMetrics(
  metrics: Record<string, unknown>,
  issues: MetricIssue[],
  recommendations: string[]
): JvmMetrics | null {
  const heapUsed = getMetric(metrics, "jvm.memory.used") ?? getMetric(metrics, "jvm_memory_used_bytes");
  const heapMax = getMetric(metrics, "jvm.memory.max") ?? getMetric(metrics, "jvm_memory_max_bytes");

  if (heapUsed === null && heapMax === null) return null;

  const used = heapUsed ?? 0;
  const max = heapMax ?? 1;
  const utilization = max > 0 ? used / max : 0;

  const jvm: JvmMetrics = {
    heapUsed: used,
    heapMax: max,
    heapUtilization: utilization,
    nonHeapUsed: getMetric(metrics, "jvm.memory.used.nonheap") ?? 0,
    threadCount: getMetric(metrics, "jvm.threads.live") ?? getMetric(metrics, "jvm_threads_current") ?? 0,
    threadDaemon: getMetric(metrics, "jvm.threads.daemon") ?? 0,
    threadPeak: getMetric(metrics, "jvm.threads.peak") ?? 0,
    gcPauseCount: getMetric(metrics, "jvm.gc.pause.count") ?? getMetric(metrics, "jvm_gc_pause_seconds_count") ?? 0,
    gcPauseTotal: getMetric(metrics, "jvm.gc.pause.total") ?? getMetric(metrics, "jvm_gc_pause_seconds_sum") ?? 0,
    loadedClasses: getMetric(metrics, "jvm.classes.loaded") ?? 0,
  };

  // Analyze JVM health
  if (utilization >= 0.9) {
    issues.push({
      severity: "CRITICAL",
      category: "jvm.memory",
      message: `Heap utilization is ${(utilization * 100).toFixed(1)}% — application is near OOM. Used: ${formatBytes(used)}, Max: ${formatBytes(max)}.`,
    });
    recommendations.push(
      "Increase heap size with -Xmx or investigate memory leaks. Capture a heap dump with jmap -dump:live,format=b,file=heap.hprof."
    );
  } else if (utilization > 0.75) {
    issues.push({
      severity: "WARNING",
      category: "jvm.memory",
      message: `Heap utilization is ${(utilization * 100).toFixed(1)}%. Used: ${formatBytes(used)}, Max: ${formatBytes(max)}.`,
    });
    recommendations.push(
      "Monitor heap usage trend. If utilization keeps rising, consider increasing -Xmx or profiling for memory leaks."
    );
  }

  if (jvm.threadCount > 500) {
    issues.push({
      severity: "WARNING",
      category: "jvm.threads",
      message: `Thread count is ${jvm.threadCount} (peak: ${jvm.threadPeak}). High thread counts indicate possible thread pool misconfiguration or thread leaks.`,
    });
    recommendations.push(
      "Review thread pool sizes. Consider using virtual threads (Java 21+) or reducing pool sizes for idle connections."
    );
  }

  if (jvm.gcPauseTotal > 5 && jvm.gcPauseCount > 0) {
    const avgPause = (jvm.gcPauseTotal / jvm.gcPauseCount) * 1000;
    if (avgPause > 200) {
      issues.push({
        severity: "WARNING",
        category: "jvm.gc",
        message: `Average GC pause is ${avgPause.toFixed(0)}ms (${jvm.gcPauseCount} pauses, ${jvm.gcPauseTotal.toFixed(1)}s total). Long GC pauses affect latency.`,
      });
      recommendations.push(
        "Consider switching to ZGC (-XX:+UseZGC) for sub-millisecond pauses, or tune G1 with -XX:MaxGCPauseMillis."
      );
    }
  }

  return jvm;
}

function extractHttpMetrics(
  metrics: Record<string, unknown>,
  issues: MetricIssue[],
  recommendations: string[]
): HttpMetrics | null {
  const totalRequests = getMetric(metrics, "http.server.requests.count") ?? getMetric(metrics, "http_server_requests_seconds_count");
  if (totalRequests === null) return null;

  const meanLatency = getMetric(metrics, "http.server.requests.mean") ?? getMetric(metrics, "http_server_requests_seconds_sum");
  const maxLatency = getMetric(metrics, "http.server.requests.max") ?? 0;
  const errorCount = getMetric(metrics, "http.server.requests.error.count") ?? 0;
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

  const http: HttpMetrics = {
    totalRequests,
    meanLatency: meanLatency ?? 0,
    maxLatency,
    errorRate,
    endpoints: [],
  };

  // Extract per-endpoint metrics if available
  const endpointData = metrics["http.server.requests.by.uri"] as Record<string, unknown>[] | undefined;
  if (Array.isArray(endpointData)) {
    for (const ep of endpointData) {
      http.endpoints.push({
        uri: (ep.uri as string) ?? "unknown",
        method: (ep.method as string) ?? "GET",
        count: (ep.count as number) ?? 0,
        meanMs: (ep.meanMs as number) ?? 0,
        maxMs: (ep.maxMs as number) ?? 0,
        errorCount: (ep.errorCount as number) ?? 0,
      });
    }
  }

  if (errorRate > 0.1) {
    issues.push({
      severity: "CRITICAL",
      category: "http",
      message: `HTTP error rate is ${(errorRate * 100).toFixed(1)}% (${errorCount} errors out of ${totalRequests} requests).`,
    });
    recommendations.push(
      "Investigate the most common error responses. Check application logs for stack traces. Review error-prone endpoints."
    );
  } else if (errorRate > 0.01) {
    issues.push({
      severity: "WARNING",
      category: "http",
      message: `HTTP error rate is ${(errorRate * 100).toFixed(1)}%.`,
    });
  }

  if (maxLatency > 10000) {
    issues.push({
      severity: "WARNING",
      category: "http.latency",
      message: `Maximum HTTP latency is ${(maxLatency / 1000).toFixed(1)}s. Some requests are extremely slow.`,
    });
    recommendations.push(
      "Identify the slowest endpoints and profile them. Common causes: missing database indexes, N+1 queries, external API timeouts."
    );
  }

  return http;
}

function analyzeDbPool(
  metrics: Record<string, unknown>,
  issues: MetricIssue[],
  recommendations: string[]
): void {
  const activeConnections = getMetric(metrics, "hikaricp.connections.active") ?? getMetric(metrics, "jdbc.connections.active");
  const maxConnections = getMetric(metrics, "hikaricp.connections.max") ?? getMetric(metrics, "jdbc.connections.max");
  const pendingConnections = getMetric(metrics, "hikaricp.connections.pending") ?? 0;

  if (activeConnections !== null && maxConnections !== null && maxConnections > 0) {
    const utilization = activeConnections / maxConnections;
    if (utilization >= 0.9) {
      issues.push({
        severity: "CRITICAL",
        category: "db.pool",
        message: `Connection pool is ${(utilization * 100).toFixed(0)}% utilized (${activeConnections}/${maxConnections}). Pool exhaustion imminent.`,
      });
      recommendations.push(
        "Increase spring.datasource.hikari.maximum-pool-size or investigate connection leaks. Check for long-running transactions."
      );
    } else if (utilization > 0.7) {
      issues.push({
        severity: "WARNING",
        category: "db.pool",
        message: `Connection pool is ${(utilization * 100).toFixed(0)}% utilized (${activeConnections}/${maxConnections}).`,
      });
    }
  }

  if (pendingConnections > 0) {
    issues.push({
      severity: "WARNING",
      category: "db.pool",
      message: `${pendingConnections} threads waiting for a database connection. Pool may be undersized.`,
    });
  }

  const timeouts = getMetric(metrics, "hikaricp.connections.timeout");
  if (timeouts !== null && timeouts > 0) {
    issues.push({
      severity: "WARNING",
      category: "db.pool",
      message: `${timeouts} database connection acquisition timeout(s) recorded. Connections are not being obtained within the configured connectionTimeout.`,
    });
    recommendations.push(
      "Connection acquisition timeouts indicate pool starvation. Increase spring.datasource.hikari.maximum-pool-size or reduce connectionTimeout. Check for long-running transactions holding connections."
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
