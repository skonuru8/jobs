/**
 * cover-letter.test.ts — unit tests for cover letter generation.
 *
 * No LLM calls. Tests:
 * - buildCoverLetterPrompt: content, fallbacks, visa handling
 * - saveCoverLetter: file format, frontmatter, filename slug
 * - stripMarkdown (indirectly via generate mock)
 * - SYSTEM_PROMPT sanity
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";

import { buildCoverLetterPrompt, SYSTEM_PROMPT } from "@/cover-letter/prompt";
import { saveCoverLetter }                        from "@/cover-letter/generate";
import { stripLatex, loadResume }                 from "@/cover-letter/resume";
import type { CoverLetterInput, CoverLetterResult } from "@/cover-letter/types";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_JOB: CoverLetterInput["job"] = {
  job_id:           "abc12345",
  title:            "Senior Java Full Stack Engineer",
  company:          "Citi",
  domain:           "fintech",
  employment_type:  "full_time",
  required_skills:  [
    { name: "java",        importance: "required",  years_required: 5 },
    { name: "spring boot", importance: "required",  years_required: 3 },
    { name: "angular",     importance: "preferred", years_required: null },
    { name: "kafka",       importance: "preferred", years_required: null },
    { name: "microservices", importance: "required", years_required: null },
  ],
  responsibilities: [
    "Design and build microservices for payment processing",
    "Own technical delivery across full stack",
    "Lead backend architecture discussions",
  ],
  yoe_min:          5,
  yoe_max:          8,
  visa_sponsorship: null,
  score:            0.854,
  score_components: { skills: 0.85, semantic: 0.63, yoe: 1.0, seniority: 1.0, location: 1.0 },
  judge_reasoning:  "Candidate's Java and Spring Boot expertise aligns perfectly. Accenture typically sponsors visas.",
  judge_concerns:   [],
};

const BASE_PROFILE: CoverLetterInput["profile"] = {
  contact: {
    name:     "ghijkl",
    email:    "abcdef@gmail.com",
    phone:    "1",
    linkedin: "linkedin.com/in/def",
    github:   "github.com/abc",
    city:     "NY City",
    state:    "NY",
  },
  skills: [
    { name: "Java",        years: 6, confidence: "expert", category: "language"   },
    { name: "Spring Boot", years: 5, confidence: "expert", category: "framework"  },
    { name: "Angular",     years: 4, confidence: "strong", category: "framework"  },
    { name: "Kafka",       years: 3, confidence: "strong", category: "tool"       },
    { name: "TypeScript",  years: 4, confidence: "strong", category: "language"   },
    { name: "Azure",       years: 5, confidence: "expert", category: "cloud"      },
    { name: "CI/CD",       years: 5, confidence: "expert", category: "methodology"},
    { name: "Microservices", years: 5, confidence: "expert", category: "methodology"},
    { name: "Docker",      years: 3, confidence: "strong", category: "tool"       },
    { name: "AWS",         years: 4, confidence: "strong", category: "cloud"      },
  ],
  years_experience:  6,
  education:         { degree: "master", field: "Computer Science" },
  preferred_domains: ["fintech", "healthcare", "enterprise saas"],
};

const BASE_INPUT: CoverLetterInput = {
  job:     BASE_JOB,
  profile: BASE_PROFILE,
  resume:  null,
};


// ---------------------------------------------------------------------------
// SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe("SYSTEM_PROMPT", () => {
  it("is non-empty and contains core rules", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(SYSTEM_PROMPT).toContain("Three paragraphs");
    expect(SYSTEM_PROMPT).toContain("clichés");
    expect(SYSTEM_PROMPT).toContain("specific");
  });

  it("bans specific cliché phrases", () => {
    expect(SYSTEM_PROMPT).toContain("excited to apply");
    expect(SYSTEM_PROMPT).toContain("passionate");
    expect(SYSTEM_PROMPT).toContain("team player");
  });
});


// ---------------------------------------------------------------------------
// buildCoverLetterPrompt
// ---------------------------------------------------------------------------

describe("buildCoverLetterPrompt", () => {
  it("includes job title and company", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("Senior Java Full Stack Engineer");
    expect(p).toContain("Citi");
  });

  it("includes domain", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("fintech");
  });

  it("includes expert skills with years", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("Java (6yr)");
    expect(p).toContain("Spring Boot (5yr)");
  });

  it("includes education level", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("master in Computer Science");
  });

  it("includes YOE requirement", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("5–8 years");
  });

  it("includes judge reasoning", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("Accenture typically sponsors visas");
  });

  it("shows visa note when sponsorship is null", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("not mentioned");
    expect(p).toContain("OPT");
  });

  it("shows 'sponsorship is explicitly offered' when visa_sponsorship = true", () => {
    const input: CoverLetterInput = { ...BASE_INPUT, job: { ...BASE_JOB, visa_sponsorship: true } };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("explicitly offered");
  });

  it("shows caution note when visa_sponsorship = false", () => {
    const input: CoverLetterInput = { ...BASE_INPUT, job: { ...BASE_JOB, visa_sponsorship: false } };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("CAUTION");
  });

  it("includes resume text when provided", () => {
    const input: CoverLetterInput = { ...BASE_INPUT, resume: "Built payment microservices at Citi." };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("Built payment microservices at Citi.");
  });

  it("shows fallback note when resume is null", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("Not provided");
  });

  it("includes matched skills (job required skills present in profile)", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    // java, spring boot, angular, kafka, microservices are all in profile
    expect(p).toContain("java");
    expect(p).toContain("spring boot");
  });

  it("handles empty responsibilities gracefully", () => {
    const input: CoverLetterInput = {
      ...BASE_INPUT,
      job: { ...BASE_JOB, responsibilities: [] },
    };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("not extracted");
  });

  it("handles null yoe gracefully", () => {
    const input: CoverLetterInput = {
      ...BASE_INPUT,
      job: { ...BASE_JOB, yoe_min: null, yoe_max: null },
    };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("not specified");
  });

  it("handles null judge_reasoning gracefully", () => {
    const input: CoverLetterInput = {
      ...BASE_INPUT,
      job: { ...BASE_JOB, judge_reasoning: null },
    };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("Strong skill and seniority alignment");
  });

  it("includes concerns when present", () => {
    const input: CoverLetterInput = {
      ...BASE_INPUT,
      job: { ...BASE_JOB, judge_concerns: ["Requires React, candidate has Angular"] },
    };
    const p = buildCoverLetterPrompt(input);
    expect(p).toContain("Requires React");
  });

  it("shows 'none' when no concerns", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p).toContain("none");
  });

  it("is non-empty and longer than 500 chars", () => {
    const p = buildCoverLetterPrompt(BASE_INPUT);
    expect(p.length).toBeGreaterThan(500);
  });
});


// ---------------------------------------------------------------------------
// saveCoverLetter
// ---------------------------------------------------------------------------

describe("saveCoverLetter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cover-letter-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const okResult: CoverLetterResult = {
    status:         "ok",
    text:           "Six years of building Java microservices...\n\nAt Citi, I...\n\nI am available immediately and require OPT sponsorship.",
    model:          "google/gemini-2.5-flash",
    prompt_version: "v1",
    generated_at:   "2026-04-23T00:00:00Z",
    word_count:     42,
  };

  it("creates the output file", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it("filename contains company and title slug", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    const filename = path.basename(filepath);
    expect(filename).toContain("citi");
    expect(filename).toContain("java");
  });

  it("filename ends with .md", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    expect(filepath.endsWith(".md")).toBe(true);
  });

  it("file contains YAML frontmatter", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    const content = fs.readFileSync(filepath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain('title:');
    expect(content).toContain('company:');
    expect(content).toContain('score:');
    expect(content).toContain('job_id:');
  });

  it("file contains the cover letter body text", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    const content = fs.readFileSync(filepath, "utf-8");
    expect(content).toContain("Six years of building Java microservices");
  });

  it("file contains judge reasoning section", () => {
    const filepath = saveCoverLetter(okResult, BASE_INPUT, tmpDir);
    const content = fs.readFileSync(filepath, "utf-8");
    expect(content).toContain("Judge notes");
    expect(content).toContain("Accenture typically sponsors visas");
  });

  it("creates output directory if it does not exist", () => {
    const nestedDir = path.join(tmpDir, "nested", "output");
    const filepath = saveCoverLetter(okResult, BASE_INPUT, nestedDir);
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it("throws when result status is error", () => {
    const errResult: CoverLetterResult = {
      status:         "error",
      text:           null,
      model:          "test",
      prompt_version: "v1",
      generated_at:   "2026-04-23T00:00:00Z",
      error:          "API failed",
    };
    expect(() => saveCoverLetter(errResult, BASE_INPUT, tmpDir)).toThrow();
  });
});


// ---------------------------------------------------------------------------
// stripLatex
// ---------------------------------------------------------------------------

describe("stripLatex", () => {
  it("removes preamble up to \\begin{document}", () => {
    const tex = `\\documentclass{article}\n\\usepackage{geometry}\n\\begin{document}\nHello world`;
    expect(stripLatex(tex)).toBe("Hello world");
  });

  it("extracts text from \\textbf and \\textit", () => {
    expect(stripLatex("\\textbf{Senior Engineer} at \\textit{Citi}")).toBe("Senior Engineer at Citi");
  });

  it("extracts \\section{} heading text", () => {
    const result = stripLatex("\\section{Experience}");
    expect(result).toContain("Experience");
  });

  it("converts \\item to bullet character", () => {
    const tex = "\\begin{itemize}\n\\item Built payment service\n\\item Reduced latency\n\\end{itemize}";
    const result = stripLatex(tex);
    expect(result).toContain("•");
    expect(result).toContain("Built payment service");
    expect(result).toContain("Reduced latency");
  });

  it("removes % comments", () => {
    const result = stripLatex("Real text % this is a comment\nMore text");
    expect(result).toContain("Real text");
    expect(result).not.toContain("this is a comment");
  });

  it("removes inline math $...$", () => {
    const result = stripLatex("Experience of $n$ years");
    expect(result).not.toContain("$");
    expect(result).toContain("Experience of");
    expect(result).toContain("years");
  });

  it("extracts href text and drops url", () => {
    const result = stripLatex("\\href{https://github.com/user}{GitHub Profile}");
    expect(result).toBe("GitHub Profile");
    expect(result).not.toContain("github.com");
  });

  it("handles \\\\  line breaks", () => {
    const result = stripLatex("Line one \\\\ Line two");
    expect(result).toContain("Line one");
    expect(result).toContain("Line two");
  });

  it("removes \\vspace and \\hspace", () => {
    const result = stripLatex("Before\\vspace{10pt}After");
    expect(result).toContain("Before");
    expect(result).toContain("After");
    expect(result).not.toContain("vspace");
  });

  it("removes leftover braces", () => {
    const result = stripLatex("{text}");
    expect(result).toBe("text");
  });

  it("handles real-world resume snippet", () => {
    const snippet = `
\\section{Experience}
\\textbf{Senior Software Engineer} \\hfill 2022--Present\\\\
\\textit{Citi} \\hfill \\textit{New York, NY}
\\begin{itemize}
  \\item Redesigned payment microservice using \\textbf{Spring Boot} + \\textbf{Kafka}, reducing latency from 800ms to 120ms
  \\item Led migration of 12 legacy services to \\textbf{Azure Service Bus}, handling 50k events/day
\\end{itemize}`;
    const result = stripLatex(snippet);
    expect(result).toContain("Senior Software Engineer");
    expect(result).toContain("Spring Boot");
    expect(result).toContain("reducing latency from 800ms to 120ms");
    expect(result).toContain("50k events/day");
    expect(result).not.toContain("\\textbf");
    expect(result).not.toContain("\\item");
  });
});


// ---------------------------------------------------------------------------
// loadResume
// ---------------------------------------------------------------------------

describe("loadResume", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when neither file exists", () => {
    expect(loadResume(tmpDir)).toBeNull();
  });

  it("loads resume.md when present", () => {
    fs.writeFileSync(path.join(tmpDir, "resume.md"), "Built payment services at Citi for 3 years.");
    const result = loadResume(tmpDir);
    expect(result).toContain("Built payment services");
  });

  it("prefers resume.tex over resume.md when both present", () => {
    fs.writeFileSync(path.join(tmpDir, "resume.tex"), "\\begin{document}\nTeX content here\n\\end{document}");
    fs.writeFileSync(path.join(tmpDir, "resume.md"),  "Markdown content here");
    const result = loadResume(tmpDir);
    expect(result).toContain("TeX content here");
    expect(result).not.toContain("Markdown content here");
  });

  it("returns null for placeholder resume.md", () => {
    fs.writeFileSync(path.join(tmpDir, "resume.md"),
      "# Resume\nFill in real bullet points\n[Company Name]\n[Bullet 1: ...]");
    expect(loadResume(tmpDir)).toBeNull();
  });

  it("strips LaTeX when loading .tex file", () => {
    fs.writeFileSync(path.join(tmpDir, "resume.tex"),
      "\\begin{document}\n\\textbf{Senior Engineer} at Citi\n\\end{document}");
    const result = loadResume(tmpDir);
    expect(result).toContain("Senior Engineer");
    expect(result).not.toContain("\\textbf");
  });
});
