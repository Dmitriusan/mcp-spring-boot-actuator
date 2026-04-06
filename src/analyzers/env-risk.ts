/**
 * Spring Boot Actuator environment risk analyzer.
 *
 * Analyzes /env endpoint data to detect:
 * - Exposed secrets and credentials
 * - Risky configurations
 * - Missing production-critical settings
 */

export interface EnvRisk {
  severity: "CRITICAL" | "WARNING" | "INFO";
  property: string;
  message: string;
  recommendation: string;
}

export interface EnvReport {
  activeProfiles: string[];
  propertySources: string[];
  risks: EnvRisk[];
  recommendations: string[];
}

// Patterns that indicate credentials or secrets
const SECRET_PATTERNS = [
  /password/i, /secret/i, /api[._-]?key/i, /token/i,
  /credential/i, /private[._-]?key/i, /access[._-]?key/i,
  /auth/i, /jwt/i, /client[._-]?secret/i,
];

// Properties that should differ between dev and production
const PRODUCTION_CHECKS: Array<{ property: string; badValues: string[]; message: string }> = [
  {
    property: "spring.jpa.hibernate.ddl-auto",
    badValues: ["create", "create-drop", "update"],
    message: "Hibernate ddl-auto is set to a destructive mode. In production, use 'validate' or 'none'.",
  },
  {
    property: "spring.jpa.show-sql",
    badValues: ["true"],
    message: "SQL logging is enabled. This hurts performance and may expose sensitive data in production.",
  },
  {
    property: "spring.h2.console.enabled",
    badValues: ["true"],
    message: "H2 console is enabled. This is a security risk in production — disable it.",
  },
  {
    property: "debug",
    badValues: ["true"],
    message: "Debug mode is enabled. This exposes verbose logging and may leak sensitive information.",
  },
  {
    property: "management.endpoints.web.exposure.include",
    badValues: ["*"],
    message: "All actuator endpoints are exposed. In production, expose only health and metrics.",
  },
  {
    property: "server.error.include-stacktrace",
    badValues: ["always", "on_param"],
    message: "Stack traces are included in error responses. This leaks internal details to clients.",
  },
  {
    property: "spring.devtools.restart.enabled",
    badValues: ["true"],
    message: "DevTools restart is enabled. This should not be active in production.",
  },
  {
    property: "spring.sql.init.mode",
    badValues: ["always"],
    message: "SQL initialisation mode is 'always' — schema.sql and data.sql run on every startup, risking data loss in production.",
  },
  {
    property: "spring.jpa.open-in-view",
    badValues: ["true"],
    message: "Open-in-view is enabled. This keeps a database connection open for the entire HTTP request lifecycle, causing N+1 query patterns and connection pool pressure under load.",
  },
];

/**
 * Analyze the /env endpoint response for security and configuration risks.
 */
export function analyzeEnv(json: string): EnvReport {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    return {
      activeProfiles: [],
      propertySources: [],
      risks: [{ severity: "CRITICAL", property: "parser", message: "Invalid JSON in env response", recommendation: "Check the /env endpoint format." }],
      recommendations: [],
    };
  }

  const activeProfiles = (data.activeProfiles as string[]) ?? [];
  const propertySources: string[] = [];
  const risks: EnvRisk[] = [];
  const recommendations: string[] = [];

  // Extract property sources
  const sources = data.propertySources as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(sources)) {
    for (const source of sources) {
      const name = source.name as string;
      if (name) propertySources.push(name);

      const properties = source.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties && typeof properties === "object") {
        analyzeProperties(properties, risks);
      }
    }
  }

  // Flat properties format (simpler JSON structure)
  if (!sources && typeof data === "object") {
    const flatProps: Record<string, Record<string, unknown>> = {};
    for (const [key, val] of Object.entries(data)) {
      if (key !== "activeProfiles" && key !== "propertySources") {
        flatProps[key] = { value: val };
      }
    }
    if (Object.keys(flatProps).length > 0) {
      analyzeProperties(flatProps, risks);
    }
  }

  // Profile-based recommendations
  if (activeProfiles.length === 0) {
    risks.push({
      severity: "WARNING",
      property: "spring.profiles.active",
      message: "No active profiles set. The application is running with default configuration.",
      recommendation: "Set spring.profiles.active to 'production' or 'prod' for production deployments.",
    });
  }

  const hasProductionProfile = activeProfiles.some(
    p => ["production", "prod", "live"].includes(p.toLowerCase())
  );

  if (!hasProductionProfile && activeProfiles.length > 0) {
    risks.push({
      severity: "INFO",
      property: "spring.profiles.active",
      message: `Active profiles: [${activeProfiles.join(", ")}]. No production profile detected.`,
      recommendation: "Verify this is not a production environment. If it is, add a 'production' profile.",
    });
  }

  // General recommendations
  if (risks.filter(r => r.severity === "CRITICAL").length > 0) {
    recommendations.push("Address all CRITICAL issues before deploying to production.");
  }

  if (propertySources.some(s => s.includes("application-dev") || s.includes("application-local"))) {
    recommendations.push(
      "Development property sources detected. Ensure production deployments use production-specific configuration."
    );
  }

  return { activeProfiles, propertySources, risks, recommendations };
}

function analyzeProperties(
  properties: Record<string, Record<string, unknown>>,
  risks: EnvRisk[]
): void {
  for (const [propName, propData] of Object.entries(properties)) {
    const value = String(propData.value ?? "");

    // Check for exposed secrets
    checkForSecrets(propName, value, risks);

    // Check for risky production configurations
    checkProductionRisks(propName, value, risks);
  }
}

function checkForSecrets(propName: string, value: string, risks: EnvRisk[]): void {
  // Skip if value is already masked (Spring Boot masks sensitive values with *****)
  if (value.includes("******") || value === "******") return;

  const isSecretProperty = SECRET_PATTERNS.some(pattern => pattern.test(propName));
  if (!isSecretProperty) return;

  // Check if the value looks like a real secret (not a placeholder or empty).
  // Match the full string against ${...} to skip only complete Spring EL placeholder
  // references (e.g. "${DB_PASSWORD}" or "${DB_PASSWORD:default}"). A value that merely
  // starts with "${" but has trailing content (e.g. "${VAR}extratext") is not a pure
  // reference and may contain real credential material — report it.
  const isPlaceholder = /^\$\{[^}]+\}$/.test(value);
  if (value.length > 5 && value !== "null" && value !== "undefined" && !isPlaceholder) {
    risks.push({
      severity: "CRITICAL",
      property: propName,
      message: `Property '${propName}' appears to contain an unmasked secret value.`,
      recommendation: `Configure management.endpoint.env.keys-to-sanitize to mask '${propName}', or use a vault/secrets manager.`,
    });
  }
}

function checkProductionRisks(propName: string, value: string, risks: EnvRisk[]): void {
  for (const check of PRODUCTION_CHECKS) {
    if (propName === check.property || propName.endsWith("." + check.property)) {
      if (check.badValues.includes(value.toLowerCase())) {
        risks.push({
          severity: "WARNING",
          property: propName,
          message: check.message,
          recommendation: `Change '${propName}' for production environments.`,
        });
      }
    }
  }
}
