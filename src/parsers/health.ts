/**
 * Spring Boot Actuator /health endpoint parser and analyzer.
 *
 * Parses the nested health indicator tree and diagnoses issues.
 * Supports Spring Boot 2.x and 3.x formats.
 */

export type HealthStatus = "UP" | "DOWN" | "OUT_OF_SERVICE" | "UNKNOWN";

export interface HealthComponent {
  name: string;
  status: HealthStatus;
  details: Record<string, unknown>;
  components?: HealthComponent[];
}

export interface HealthReport {
  overallStatus: HealthStatus;
  components: HealthComponent[];
  issues: HealthIssue[];
  recommendations: string[];
}

export interface HealthIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  component: string;
  message: string;
}

/**
 * Parse actuator /health JSON response.
 */
export function parseHealth(json: string): HealthReport {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return {
      overallStatus: "UNKNOWN",
      components: [],
      issues: [{ severity: "CRITICAL", component: "parser", message: "Invalid JSON in health response" }],
      recommendations: ["Verify the actuator /health endpoint is returning valid JSON."],
    };
  }

  const overallStatus = normalizeStatus(data.status as string);
  const components = extractComponents(data);
  const issues: HealthIssue[] = [];
  const recommendations: string[] = [];

  // Analyze each component
  for (const comp of components) {
    analyzeComponent(comp, issues, recommendations);
  }

  // Overall status analysis
  if (overallStatus === "DOWN") {
    issues.push({
      severity: "CRITICAL",
      component: "application",
      message: "Application health status is DOWN — one or more critical dependencies are failing.",
    });
  } else if (overallStatus === "OUT_OF_SERVICE") {
    issues.push({
      severity: "WARNING",
      component: "application",
      message: "Application is OUT_OF_SERVICE — may be in maintenance or graceful shutdown.",
    });
  }

  // Check for no components (health endpoint might be restricted)
  if (components.length === 0 && overallStatus === "UP") {
    recommendations.push(
      "Health response has no component details. Set management.endpoint.health.show-details=always to expose component health."
    );
  }

  return { overallStatus, components, issues, recommendations };
}

function normalizeStatus(status: string | undefined): HealthStatus {
  if (!status) return "UNKNOWN";
  const upper = status.toUpperCase();
  if (upper === "UP" || upper === "DOWN" || upper === "OUT_OF_SERVICE" || upper === "UNKNOWN") {
    return upper as HealthStatus;
  }
  return "UNKNOWN";
}

function extractComponents(data: Record<string, unknown>): HealthComponent[] {
  const components: HealthComponent[] = [];

  // Spring Boot 2.x/3.x: components are under "components" key
  const comps = (data.components || data.details) as Record<string, unknown> | undefined;
  if (!comps || typeof comps !== "object") return components;

  for (const [name, value] of Object.entries(comps)) {
    if (value && typeof value === "object") {
      const comp = value as Record<string, unknown>;
      const component: HealthComponent = {
        name,
        status: normalizeStatus(comp.status as string),
        details: {},
      };

      // Extract details (everything except status and components)
      if (comp.details && typeof comp.details === "object") {
        component.details = comp.details as Record<string, unknown>;
      } else {
        for (const [k, v] of Object.entries(comp)) {
          if (k !== "status" && k !== "components") {
            component.details[k] = v;
          }
        }
      }

      // Recurse into nested components
      if (comp.components && typeof comp.components === "object") {
        const nested = { components: comp.components } as Record<string, unknown>;
        component.components = extractComponents(nested);
      }

      components.push(component);
    }
  }

  return components;
}

function analyzeComponent(comp: HealthComponent, issues: HealthIssue[], recommendations: string[]): void {
  if (comp.status === "DOWN") {
    issues.push({
      severity: "CRITICAL",
      component: comp.name,
      message: `${comp.name} is DOWN: ${formatDetails(comp.details)}`,
    });

    // Component-specific recommendations
    if (comp.name === "db" || comp.name === "dataSource") {
      recommendations.push(
        `Database health check failed. Verify: 1) Database server is running, 2) Connection string in spring.datasource.url is correct, 3) Database credentials are valid, 4) Network connectivity to DB host.`
      );
    } else if (comp.name === "redis") {
      recommendations.push(
        "Redis health check failed. Verify Redis server is running and spring.data.redis.host/port are correct."
      );
    } else if (comp.name === "rabbit" || comp.name === "rabbitMQ") {
      recommendations.push(
        "RabbitMQ health check failed. Verify RabbitMQ server is running and spring.rabbitmq.* properties are correct."
      );
    } else if (comp.name === "kafka") {
      recommendations.push(
        "Kafka health check failed. Verify Kafka brokers are reachable and spring.kafka.bootstrap-servers is correct."
      );
    } else if (comp.name === "mail") {
      recommendations.push(
        "Mail server health check failed. Verify SMTP server configuration in spring.mail.* properties."
      );
    } else if (comp.name === "elasticsearch") {
      recommendations.push(
        "Elasticsearch health check failed. Verify cluster is reachable and spring.elasticsearch.uris is correct."
      );
    } else if (comp.name === "mongo" || comp.name === "mongodb") {
      recommendations.push(
        "MongoDB health check failed. Verify MongoDB server is reachable and spring.data.mongodb.uri is correct."
      );
    } else if (comp.name === "cassandra") {
      recommendations.push(
        "Cassandra health check failed. Verify Cassandra contact points and spring.cassandra.contact-points are correct."
      );
    } else if (comp.name === "diskSpace") {
      const threshold = comp.details.threshold as number | undefined;
      const free = comp.details.free as number | undefined;
      if (threshold !== undefined && free !== undefined) {
        recommendations.push(
          `Disk space below threshold. Free: ${formatBytes(free)}, Threshold: ${formatBytes(threshold)}. Free up disk space or increase the threshold.`
        );
      } else {
        recommendations.push("Disk space health check failed. Free up disk space on the application server.");
      }
    } else {
      recommendations.push(
        `${comp.name} health check failed. Review the error details and check the connection/configuration for this component.`
      );
    }
  } else if (comp.status === "OUT_OF_SERVICE") {
    issues.push({
      severity: "WARNING",
      component: comp.name,
      message: `${comp.name} is OUT_OF_SERVICE: ${formatDetails(comp.details)}`,
    });
  }

  // Check disk space warning even if UP
  if (comp.name === "diskSpace" && comp.status === "UP") {
    const free = comp.details.free as number | undefined;
    const total = comp.details.total as number | undefined;
    if (free !== undefined && total !== undefined && total > 0 && free / total < 0.15) {
      issues.push({
        severity: "WARNING",
        component: "diskSpace",
        message: `Disk space is low: ${formatBytes(free)} free of ${formatBytes(total)} total (${((free / total) * 100).toFixed(1)}%).`,
      });
      recommendations.push("Disk space is below 15%. Consider cleaning up logs, temp files, or increasing disk size.");
    }
  }

  // Recurse into nested components
  if (comp.components) {
    for (const nested of comp.components) {
      analyzeComponent(nested, issues, recommendations);
    }
  }
}

function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return "no details available";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(", ");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
