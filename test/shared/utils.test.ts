import { describe, expect, it } from "vitest";

import { applyScopedTechSwaps, applyTechSwaps, escapeRegexStr } from "@/shared/utils";

describe("shared utils", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegexStr("AWS S3 (prod)")).toBe("AWS S3 \\(prod\\)");
  });

  it("applies multi-word tech swaps without touching substrings", () => {
    const out = applyTechSwaps("AWS S3, not MyAWS S3Backup", [{ from: "AWS S3", to: "S3" }]);
    expect(out).toBe("S3, not MyAWS S3Backup");
  });

  it("applies scoped swaps only to the matching experience block", () => {
    const block = [
      "Hitachi Vantara / Nokia",
      "  - Built Java services on Azure Cosmos DB.",
      "",
      "AquilaEdge LLC",
      "  - Built Node.js services on Azure Cosmos DB.",
    ].join("\n");

    const out = applyScopedTechSwaps(block, [
      { from: "Azure Cosmos DB", to: "Cosmos DB", target_role: "Hitachi Vantara / Nokia" },
    ]);

    expect(out).toContain("Built Java services on Cosmos DB.");
    expect(out).toContain("Built Node.js services on Azure Cosmos DB.");
  });

  it("applies unscoped swaps across all experience blocks", () => {
    const block = [
      "Hitachi Vantara / Nokia",
      "  - Built Java services on AWS S3.",
      "",
      "AquilaEdge LLC",
      "  - Built Node.js services on AWS S3.",
    ].join("\n");

    const out = applyScopedTechSwaps(block, [{ from: "AWS S3", to: "S3", target_role: null }]);
    expect(out).not.toContain("AWS S3");
    expect(out.match(/S3/g)?.length).toBe(2);
  });

  it("applyScopedTechSwaps: scoped swap only modifies the matching section", () => {
    const block = "Hitachi Vantara\n  - Built pipelines using Azure Service Bus\n\nPersistent Systems\n  - Used Azure Service Bus for events";
    const result = applyScopedTechSwaps(block, [
      { from: "Azure Service Bus", to: "AWS SQS", target_role: "Hitachi Vantara" },
    ]);
    expect(result).toContain("Hitachi Vantara");
    expect(result).toContain("AWS SQS");
    expect(result).toContain("Persistent Systems");
    expect(result).toContain("Persistent Systems\n  - Used Azure Service Bus for events");
  });

  it("applyScopedTechSwaps: unscoped swap applies globally", () => {
    const block = "Hitachi Vantara\n  - Built using Camunda\n\nPersistent Systems\n  - Used Camunda for workflows";
    const result = applyScopedTechSwaps(block, [
      { from: "Camunda", to: "Flowable", target_role: null },
    ]);
    expect(result).not.toContain("Camunda");
  });
});
