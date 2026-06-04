import { describe, expect, it } from "vitest";

import {
  buildCoverLetterPrompt,
  renderCoverLetterGapDirectives,
  renderFabricatedClaimsBlock,
  renderSwapsBlock,
} from "@/cover-letter/prompt";
import { looksTruncated } from "@/cover-letter/generator";
import type { CoverLetterInput } from "@/cover-letter/types";

const BASE_INPUT: CoverLetterInput = {
  job: {
    job_id: "job-1",
    title: "Senior Java Engineer",
    company: "Citi",
    domain: "fintech",
    employment_type: "full_time",
    required_skills: [
      { name: "Java", importance: "required", years_required: 5 },
    ],
    responsibilities: ["Build backend services"],
    yoe_min: 5,
    yoe_max: 8,
    visa_sponsorship: "unmentioned",
    visa_quote: null,
    score: 0.8,
    score_components: { skills: 0.8, semantic: 0.7, yoe: 1, seniority: 1, location: 1 },
    judge_reasoning: "Strong fit.",
    judge_concerns: [],
  },
  profile: {
    contact: {
      name: "Sarath",
      email: "sarath@example.com",
      phone: "555-555-5555",
      linkedin: "linkedin.com/in/sarath",
      github: "github.com/sarath",
      city: "Jersey City",
      state: "NJ",
    },
    skills: [
      { name: "Java", years: 6, confidence: "expert", category: "language" },
    ],
    years_experience: 6,
    education: { degree: "master", field: "Computer Science" },
    preferred_domains: ["fintech"],
    work_authorization: {
      requires_sponsorship: true,
      visa_type: "F-1 OPT",
      clearance_eligible: false,
      cover_letter_phrasing_sponsorship_needed: "I am authorized to work in the United States on F-1 OPT and will require H-1B sponsorship at the standard transition point.",
      cover_letter_phrasing_no_sponsorship_needed: "",
    },
  },
  resume: null,
  experience_block: "Hitachi Vantara / Nokia\n- Built Java services on Azure Cosmos DB.",
};

describe("cover letter gap directives", () => {
  it("omits directives section when gap_directives is empty", () => {
    const prompt = buildCoverLetterPrompt({ ...BASE_INPUT, gap_directives: [] });
    expect(prompt).not.toContain("=== JUDGE GAP DIRECTIVES");
  });

  it("includes SILENTLY FABRICATE block for fabricate directives", () => {
    const rendered = renderCoverLetterGapDirectives([
      {
        jd_requirement: "MongoDB",
        handling: "fabricate",
        target_role: "Project: Nokia",
        frame_as: "Document-oriented persistence for high-volume contract data.",
      },
    ]);
    expect(rendered).toContain("SILENTLY FABRICATE");
    expect(rendered).toContain("Project: Nokia");
  });

  it("includes FORBIDDEN block for forbid directives", () => {
    const rendered = renderCoverLetterGapDirectives([
      {
        jd_requirement: "FX trading",
        handling: "forbid",
        target_role: null,
        frame_as: null,
      },
    ]);
    expect(rendered).toContain("FORBIDDEN");
    expect(rendered).toContain("FX trading");
  });

  it("includes ACKNOWLEDGE block with frame_as", () => {
    const rendered = renderCoverLetterGapDirectives([
      {
        jd_requirement: "Capital markets",
        handling: "acknowledge",
        target_role: "Persistent Systems",
        frame_as: "Adjacent regulated-enterprise delivery with complex data platforms.",
      },
    ]);
    expect(rendered).toContain("ACKNOWLEDGE");
    expect(rendered).toContain("Adjacent regulated-enterprise delivery");
  });

  it("renders active scoped tech swaps for cover narration", () => {
    const rendered = renderSwapsBlock([
      { from: "Node.js", to: "Spring Boot", confidence: 0.9, target_role: "AquilaEdge LLC" },
    ]);
    expect(rendered).toContain("\"Node.js\" -> \"Spring Boot\"");
    expect(rendered).toContain("AquilaEdge LLC");
  });

  it("renders fabricated claims for resume-cover consistency", () => {
    const rendered = renderFabricatedClaimsBlock([
      {
        jd_requirement: "MongoDB",
        handling: "fabricate",
        target_role: "AquilaEdge LLC",
        frame_as: "Implemented MongoDB document collections for DaxP.",
      },
    ]);
    expect(rendered).toContain("AquilaEdge LLC");
    expect(rendered).toContain("Implemented MongoDB");
  });

  it("detects truncated cover letter bodies", () => {
    expect(looksTruncated("This ends mid sentence")).toBe(true);
    expect(looksTruncated("This ends cleanly.")).toBe(false);
  });
});
