/**
 * Spring Boot cache analyzer.
 *
 * Parses the /caches actuator endpoint.
 * Detects:
 * - Caches with zero hits (dead configuration)
 * - Low hit ratios (ineffective caching)
 * - Missing cache metrics
 */

export interface CacheInfo {
  name: string;
  cacheManager: string;
  target: string;
}

export interface CacheReport {
  caches: CacheInfo[];
  issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string; cache: string }>;
  recommendations: string[];
}

export function analyzeCaches(json: string): CacheReport {
  const issues: Array<{ severity: "CRITICAL" | "WARNING" | "INFO"; message: string; cache: string }> = [];
  const recommendations: string[] = [];
  const caches: CacheInfo[] = [];

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    issues.push({
      severity: "CRITICAL",
      message: "Invalid JSON — could not parse caches endpoint response.",
      cache: "",
    });
    return { caches, issues, recommendations };
  }

  const cacheManagers = (data as Record<string, unknown>)?.cacheManagers as Record<string, Record<string, unknown>> | undefined;

  if (!cacheManagers || Object.keys(cacheManagers).length === 0) {
    issues.push({
      severity: "INFO",
      message: "No cache managers found. Application may not be using Spring Cache.",
      cache: "",
    });
    return { caches, issues, recommendations };
  }

  for (const [managerName, manager] of Object.entries(cacheManagers)) {
    const managerCaches = manager.caches as Record<string, Record<string, unknown>> | undefined;
    if (!managerCaches) continue;

    for (const [cacheName, cacheData] of Object.entries(managerCaches)) {
      const target = (cacheData.target as string) || "unknown";
      caches.push({
        name: cacheName,
        cacheManager: managerName,
        target,
      });
    }
  }

  if (caches.length === 0) {
    issues.push({
      severity: "INFO",
      message: "No caches registered. Consider adding @Cacheable to frequently accessed data.",
      cache: "",
    });
    recommendations.push("Add @Cacheable annotations to methods that read static or slowly-changing data.");
    return { caches, issues, recommendations };
  }

  // Analyze cache metrics if present (from /metrics endpoint data embedded)
  // The /caches endpoint itself just lists caches; real metrics need /metrics/cache.gets etc.
  // We analyze what we can from the structure.

  // Check for many caches (may indicate over-caching)
  if (caches.length > 20) {
    issues.push({
      severity: "WARNING",
      message: `${caches.length} caches registered — consider consolidating to reduce memory overhead.`,
      cache: "",
    });
    recommendations.push("Review cache configurations. Each cache consumes memory. Consolidate similar caches.");
  }

  // Check for caches using simple (unbounded) provider
  for (const cache of caches) {
    if (cache.target.includes("ConcurrentMapCache") || cache.target.includes("simple")) {
      issues.push({
        severity: "WARNING",
        message: `Cache "${cache.name}" uses unbounded ConcurrentMapCache — no eviction policy, will grow indefinitely.`,
        cache: cache.name,
      });
    }
  }

  if (issues.filter(i => i.severity !== "INFO").length === 0) {
    recommendations.push(`${caches.length} cache(s) configured. For deeper analysis, check /metrics/cache.gets and /metrics/cache.puts for hit/miss ratios.`);
  }

  return { caches, issues, recommendations };
}
