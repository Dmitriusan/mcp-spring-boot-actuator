import { describe, it, expect } from "vitest";
import { validateLicense, formatUpgradePrompt } from "../src/license.js";

describe("Actuator license validation", () => {
  it("returns free mode when no key", () => {
    const result = validateLicense(undefined, "spring-boot-actuator");
    expect(result.isPro).toBe(false);
    expect(result.reason).toBe("No license key provided");
  });

  it("returns free mode for empty string", () => {
    expect(validateLicense("", "spring-boot-actuator").isPro).toBe(false);
  });

  it("returns free mode for invalid key", () => {
    expect(validateLicense("MCPJBS-AAAAA-AAAAA-AAAAA-AAAAA", "spring-boot-actuator").isPro).toBe(false);
  });

  it("returns free mode for wrong prefix", () => {
    const result = validateLicense("WRONG-AAAAA-AAAAA-AAAAA-AAAAA", "spring-boot-actuator");
    expect(result.reason).toContain("missing MCPJBS- prefix");
  });
});

describe("Actuator upgrade prompts", () => {
  const proTools = [
    ["analyze_beans", "Bean architecture"],
    ["analyze_startup", "Startup performance"],
    ["analyze_caches", "Cache health"],
  ] as const;

  for (const [tool, desc] of proTools) {
    it(`${tool} prompt includes tool name and pricing`, () => {
      const prompt = formatUpgradePrompt(tool, desc);
      expect(prompt).toContain(`${tool} (Pro Feature)`);
      expect(prompt).toContain("MCP_LICENSE_KEY");
      expect(prompt).toContain("$19/month");
    });
  }
});
