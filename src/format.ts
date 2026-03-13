/**
 * Shared formatting utilities for analyzer output.
 */

/**
 * Generate a severity summary line from an array of items with a severity field.
 * Returns a string like "Summary: 2 critical, 3 warnings, 1 info"
 * or "No issues found" if the array is empty.
 */
export function formatSeveritySummary(
  items: ReadonlyArray<{ severity: "CRITICAL" | "WARNING" | "INFO" }>,
): string {
  if (items.length === 0) {
    return "\n---\nNo issues found";
  }

  let critical = 0;
  let warning = 0;
  let info = 0;

  for (const item of items) {
    switch (item.severity) {
      case "CRITICAL": critical++; break;
      case "WARNING": warning++; break;
      case "INFO": info++; break;
    }
  }

  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (warning > 0) parts.push(`${warning} warning${warning !== 1 ? "s" : ""}`);
  if (info > 0) parts.push(`${info} info`);

  return `\n---\n**Summary**: ${parts.join(", ")}`;
}
