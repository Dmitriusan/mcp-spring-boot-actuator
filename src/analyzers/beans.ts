/**
 * Spring Boot Actuator beans analyzer.
 *
 * Analyzes /beans endpoint data to detect:
 * - Circular dependencies
 * - Scope mismatches (singleton depending on prototype)
 * - Bean count per context
 */

export interface BeanInfo {
  name: string;
  scope: string;
  type: string;
  dependencies: string[];
  resource: string | null;
}

export interface BeanIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  beans: string[];
}

export interface BeansReport {
  totalBeans: number;
  contexts: string[];
  beans: BeanInfo[];
  issues: BeanIssue[];
  recommendations: string[];
}

/**
 * Parse and analyze the /beans endpoint response.
 */
export function analyzeBeans(json: string): BeansReport {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return {
      totalBeans: 0,
      contexts: [],
      beans: [],
      issues: [{ severity: "CRITICAL", message: "Invalid JSON in beans response", beans: [] }],
      recommendations: [],
    };
  }

  const beans: BeanInfo[] = [];
  const contexts: string[] = [];
  const issues: BeanIssue[] = [];
  const recommendations: string[] = [];

  // Spring Boot format: { contexts: { "application": { beans: { ... } } } }
  const ctxs = data.contexts as Record<string, Record<string, unknown>> | undefined;
  if (ctxs && typeof ctxs === "object") {
    for (const [ctxName, ctxData] of Object.entries(ctxs)) {
      contexts.push(ctxName);
      const ctxBeans = ctxData.beans as Record<string, Record<string, unknown>> | undefined;
      if (ctxBeans) {
        extractBeans(ctxBeans, beans);
      }
    }
  }

  // Flat format: { beans: { ... } } or just bean map directly
  const flatBeans = data.beans as Record<string, Record<string, unknown>> | undefined;
  if (flatBeans && typeof flatBeans === "object") {
    extractBeans(flatBeans, beans);
  }

  // If we still have no beans, try treating the whole object as a bean map
  if (beans.length === 0 && !ctxs && !flatBeans) {
    for (const [name, val] of Object.entries(data)) {
      if (val && typeof val === "object" && "scope" in (val as Record<string, unknown>)) {
        const beanData = val as Record<string, unknown>;
        beans.push({
          name,
          scope: (beanData.scope as string) ?? "singleton",
          type: (beanData.type as string) ?? "unknown",
          dependencies: (beanData.dependencies as string[]) ?? [],
          resource: (beanData.resource as string) ?? null,
        });
      }
    }
  }

  // Analyze
  detectCircularDependencies(beans, issues);
  detectScopeMismatches(beans, issues, recommendations);
  analyzeBeanCount(beans, issues, recommendations);

  return {
    totalBeans: beans.length,
    contexts,
    beans,
    issues,
    recommendations,
  };
}

function extractBeans(beanMap: Record<string, Record<string, unknown>>, beans: BeanInfo[]): void {
  for (const [name, beanData] of Object.entries(beanMap)) {
    beans.push({
      name,
      scope: (beanData.scope as string) ?? "singleton",
      type: (beanData.type as string) ?? "unknown",
      dependencies: (beanData.dependencies as string[]) ?? [],
      resource: (beanData.resource as string) ?? null,
    });
  }
}

/**
 * Detect circular dependencies by building a dependency graph and finding cycles.
 */
function detectCircularDependencies(beans: BeanInfo[], issues: BeanIssue[]): void {
  const beanNames = new Set(beans.map(b => b.name));
  const adjList = new Map<string, string[]>();

  for (const bean of beans) {
    const validDeps = bean.dependencies.filter(d => beanNames.has(d));
    adjList.set(bean.name, validDeps);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const deps = adjList.get(node) || [];
    for (const dep of deps) {
      dfs(dep, [...path]);
    }

    inStack.delete(node);
  }

  for (const bean of beans) {
    if (!visited.has(bean.name)) {
      dfs(bean.name, []);
    }
  }

  // Deduplicate cycles
  const seen = new Set<string>();
  for (const cycle of cycles) {
    const key = [...cycle].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      severity: "WARNING",
      message: `Circular dependency detected: ${cycle.join(" → ")} → ${cycle[0]}`,
      beans: cycle,
    });
  }
}

/**
 * Detect scope mismatches: singleton beans depending on prototype beans.
 */
function detectScopeMismatches(
  beans: BeanInfo[],
  issues: BeanIssue[],
  recommendations: string[]
): void {
  const beansByName = new Map(beans.map(b => [b.name, b]));

  for (const bean of beans) {
    if (bean.scope !== "singleton") continue;

    for (const dep of bean.dependencies) {
      const depBean = beansByName.get(dep);
      if (depBean && depBean.scope === "prototype") {
        issues.push({
          severity: "WARNING",
          message: `Singleton '${bean.name}' depends on prototype '${dep}'. The prototype will only be injected once — it won't create new instances per use.`,
          beans: [bean.name, dep],
        });
        recommendations.push(
          `Inject ObjectFactory<${depBean.type}> or ObjectProvider<${depBean.type}> instead of direct injection for prototype bean '${dep}'.`
        );
      }
    }
  }
}

/**
 * Analyze overall bean count and flag potential issues.
 */
function analyzeBeanCount(
  beans: BeanInfo[],
  issues: BeanIssue[],
  recommendations: string[]
): void {
  if (beans.length > 500) {
    issues.push({
      severity: "INFO",
      message: `Application has ${beans.length} beans. Large bean count may affect startup time.`,
      beans: [],
    });
    recommendations.push(
      "Consider using @Lazy annotation on beans that aren't needed at startup, or use spring.main.lazy-initialization=true for development."
    );
  }

  // Find beans with many dependencies (potential god objects)
  const highDep = beans.filter(b => b.dependencies.length > 10);
  if (highDep.length > 0) {
    issues.push({
      severity: "INFO",
      message: `${highDep.length} bean(s) have >10 dependencies: ${highDep.map(b => `${b.name} (${b.dependencies.length})`).join(", ")}. These may be doing too much.`,
      beans: highDep.map(b => b.name),
    });
  }
}
