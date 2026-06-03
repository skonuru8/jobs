import { describe, expect, it } from "vitest";

import { findBannedStylePhrases, hasBannedStylePhrase } from "@/shared/style-lint";

describe("style lint", () => {
  it("detects bridging phrases", () => {
    expect(hasBannedStylePhrase("patterns analogous to Splunk observability")).toBe(true);
    expect(hasBannedStylePhrase("demonstrating transferable skills in C#")).toBe(true);
    expect(hasBannedStylePhrase("patterns comparable to Pivotal Cloud Foundry")).toBe(true);
    expect(hasBannedStylePhrase("patterns that translate directly to SOAP")).toBe(true);
    expect(hasBannedStylePhrase("Gained hands-on exposure to Kubernetes.")).toBe(true);
    expect(hasBannedStylePhrase("deepening understanding of deployment orchestration")).toBe(true);
    expect(hasBannedStylePhrase("working knowledge of Vue.js")).toBe(true);
  });

  it("allows direct factual prose", () => {
    expect(hasBannedStylePhrase("Implemented Redis caching and Azure Monitor dashboards.")).toBe(false);
  });

  it("returns matching pattern names", () => {
    expect(findBannedStylePhrases("This is directly applicable to fintech.").length).toBeGreaterThan(0);
  });
});
