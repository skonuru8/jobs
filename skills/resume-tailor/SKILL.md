---
name: resume-tailor
description: >
  All-in-one resume editing skill with four modes: (A) Full tailoring — customize
  a resume to a job description with reordering, reframing, ATS optimization, and
  metrics bolding; (B) Tech substitution — swap existing tech keywords without
  touching anything else; (C) Contextual integration — keyword "rmod", adds or
  modifies a bullet in a specific role to incorporate a required technology
  naturally, updates Skills section automatically; (D) Auto-analysis — keyword
  "total", autonomously decides all changes needed across all modes, batches them
  for one approval round, then generates the final resume. Resume is always loaded
  from project knowledge — user only provides the job description or instructions.
  Triggers: "tailor my resume", "customize for this job", "swap technologies",
  "update tech stack", "rmod", "total". Always propose changes and wait for
  explicit approval before applying.
---

> **Pipeline note:** This skill is used only in manual chat-based tailoring (when you
> type `total` or `rmod` in Claude chat). It is NOT loaded or used by the pipeline.
> The pipeline's `src/resume-generator/prompt.ts` (`TOTAL_MODE_PROMPT`) replaced the
> old SKILL.md + PIPELINE_OVERRIDE chain in v12. Keep this file for manual tailoring
> use; do not modify it expecting pipeline behavior to change.
 
# Resume Tailor
 
One skill for all resume editing needs. Covers full job-application tailoring,
targeted tech stack substitution, and contextual tech integration — all with
consent-first, integrity-preserving rules.
 
---
 
## Four Modes
 
| Mode | When it activates | What it does |
|---|---|---|
| **A — Full Tailoring** | User provides a resume + job description and asks to tailor/customize | Reorders, reframes, bolds metrics, optimizes ATS keywords, adds relevant skills |
| **B — Tech Substitution** | User asks to swap specific technologies (e.g., "swap React → Angular") | Replaces tech names in bullet points, project descriptions, and Skills section |
| **C — Contextual Integration** | User types `rmod` or says "add [tech] to [role/project]" | Reads existing role bullets, proposes a natural addition or extension, updates Skills section |
| **D — Auto-Analysis** | User types `total` with resume + job description | Autonomously decides every change needed across Modes A, B, and C — batches all proposals for one approval round, then generates the final resume |
 
---
 
## Core Principles (NON-NEGOTIABLE)
 
### 1. No Unilateral Changes
- **NEVER edit without consent** — flag every proposed change and wait for explicit approval
- Format: "I recommend [change] because [reason]. Should I proceed?"
- Batch proposals by section for efficiency
### 2. Preserve & Enhance Skills
- **NEVER delete existing skills** — skills only grow, never shrink
- Reorder skills to prioritize job-relevant ones
- New skills may be added to the Skills section with user consent (Mode A)
- Contextual integrations (Mode C) automatically add the tech to the Skills section upon approval
### 3. Accuracy & Substance First
- **NEVER oversimplify or flatten content** — maintain all substantive details
- Preserve specific numbers, technologies, frameworks, and context
- Avoid generic language that sacrifices accuracy
- Keep data density high for ATS keywords
### 4. CAR / STAR Framework for All Written Bullets
 
Every new or rewritten bullet point — whether from a Mode A reframe, Mode C integration, or Mode D auto-analysis — must follow either the **CAR** or **STAR** framework. Never write a flat, task-only bullet.
 
**CAR (Challenge → Action → Result):**
> *What was the problem or challenge? What did you do? What was the outcome?*
- Best for: concise bullets where situation is implied by context
- Format: `[Action verb] [what you did + technology used] to [solve challenge], resulting in [measurable outcome]`
- Example: `"Containerized backend microservices using Docker to eliminate environment inconsistencies, reducing deployment failures by 35%"`
**STAR (Situation → Task → Action → Result):**
> *What was the context? What was your responsibility? What did you do? What was the outcome?*
- Best for: bullets that need more context (new projects, leadership roles, cross-team work)
- Format: `[Context/situation], [your responsibility] — [action taken using tech], achieving [result]`
- Example: `"Amid a platform migration to cloud-native architecture, led containerization of 8 microservices using Docker and Kubernetes, cutting release cycle from 2 weeks to 3 days"`
**Rules:**
- Always end with a result — even if approximate (e.g., "improving team velocity", "reducing manual effort")
- **Bold** all quantifiable results
- If the existing bullet being extended already has a result, preserve it and weave the new tech into the Action part
- Never write a bullet that is pure task description with no outcome
### 5. Tech Changes — Integrity Rules
 
**Mode B (Substitution):**
- The source technology must already exist in that location
- Replace only the tech name — do not alter surrounding words or sentence structure
- Preserve casing conventions of the original (e.g., "react.js" → "vue.js", not "Vue.js")
- Apply across ALL locations (Skills section, bullet points, project descriptions) unless told otherwise
**Mode C (Contextual Integration via `rmod`):**
- Read and understand the full content of the target role/project before proposing anything
- Prefer *extending* an existing bullet over creating a standalone new one
- The addition must be contextually plausible: does this tech make sense given the work described?
- Wording must match the seniority, voice, and scope of existing bullets — not feel bolted on
- Upon approval, update both the bullet and the Skills section in the same change
**Plausibility check (Mode C):**
1. Is the tech required or strongly preferred in the JD?
2. Does it make contextual sense for the work in the target role? (e.g., Docker fits a backend role ✓; adding React to a data engineering role ✗)
3. Does the proposed wording match the seniority and scope of existing bullets?
4. If any check fails → flag it, explain why, ask user to confirm or provide more context before proceeding
### 6. Metrics Must Pop
- **BOLD all quantifiable outcomes** — numbers, percentages, dollar amounts
- Format: Achieved **X% improvement** or Generated **$XXM in revenue**
- Never bury stats in plain text
### 7. ATS & Keyword Density
- **NEVER remove bullet points or condense content** — brevity ≠ quality
- Keyword density triggers ATS systems; maintain comprehensive lists
- Match job description terminology while preserving original achievements
### 8. Aggressive Positioning
- **NEVER undersell experience** — frame everything in the most impressive light
- Use confident, impact-driven language (not humble or modest)
- Reframe responsibilities as achievements
### 9. Formatting Standards
- Use plain hyphens (-) instead of em-dashes, en-dashes, or double-hyphens. Banned chars: U+2014 (—), U+2013 (–), LaTeX "--" and "---".
- No dash clutter; maintain clean, professional formatting
- Projects must be explicit subsections under employer umbrellas, never standalone
---
 
## Workflow
 
### Phase 0 — Detect Mode
- Message starts with **`rmod`** or contains "add [tech] to [role/project]" → **Mode C**
- Message starts with **`total`** → **Mode D** (only the JD is needed from the user)
- User provides a job description and asks to tailor/customize → **Mode A**
- User asks to swap specific tech names → **Mode B**
- If ambiguous, ask: "Should I do a full tailoring, a tech swap, or a targeted addition?"
- In all modes, the resume is loaded from project knowledge exclusively — never from chat history, even if a resume is visible in the conversation
- **Multi-resume context warning:** In long job-search sessions there may be 10–20 modified resumes in the chat (one per job applied). NEVER use the most recent resume in chat — it is a tailored draft for a previous job, not the source of truth. Always go back to project knowledge for every new request, regardless of how many resumes appear in the conversation.
---
 
### Phase 1 — Analysis
 
**All modes:** Load the resume from project knowledge
- The resume is **always and exclusively** sourced from project knowledge — never from the chat history
- **Critical — multi-resume sessions:** When tailoring for multiple jobs in the same chat, there may be 10–20 previously generated resumes in the conversation. Each one is a job-specific tailored draft, not the original. NEVER pick up the latest or any prior resume from chat and use it as the base — doing so stacks modifications on modifications and corrupts the source. Every single request must start fresh from the project knowledge resume, no exceptions.
- If a resume appears in the conversation (e.g., a previously modified version), **ignore it entirely**
- The project knowledge resume is the only authoritative source; all analysis, diffs, and changes are based on it
- If for any reason the resume cannot be found in project knowledge, ask: "I couldn't find your resume in project knowledge — could you paste it here?"
- Identify every location where technology names appear: Skills section, inline bullet points, project descriptions
- Note existing metrics, achievements, scope, and seniority per role
**Mode A only:** Extract job requirements
- Key hard skills (technologies, tools, frameworks)
- Soft skills and competencies
- Industry-specific language and terminology
- Seniority indicators and measurable success metrics
**Mode C only:** Deep-read the target role/project
- What is the actual work being described?
- What technologies are already present?
- Which existing bullet is the best candidate for extension?
---
 
### Phase 2 — Plan & Validate
 
**Mode D only:** Full autonomous cross-mode analysis
- Extract every hard skill, tool, framework, and technology mentioned in the JD
- Map each JD requirement against the resume — identify gaps, partial matches, and direct matches
- For each requirement, decide the action:
  - Direct match → no change needed
  - Present in resume under a different name → **swap it (Mode B)**
  - Missing from resume entirely → **attempt contextual integration (Mode C)**; scan every role/project to find the best plausible home for it; if a plausible home is found, draft the bullet and include it in proposals
  - Weak, passive, or unmetric'd bullets → **reframe them (Mode A)**
  - Section ordering not leading with most relevant experience → **reorder (Mode A)**
**Gap resolution rule — never stop at "not in resume", never fabricate:**
For every JD requirement missing from the resume, attempt to resolve it honestly before presenting proposals:
1. Scan all roles for **adjacent, genuine experience** that can be repositioned using the missing tech's domain language — without claiming the specific tool itself was used
2. If adjacent experience exists → draft a reframe tagged `[MODE A / DOMAIN REFRAME]` that surfaces the real work in terms the JD recognizes, without naming the missing tool as something the person used
3. If no adjacent experience exists → mark as `[TRUE GAP]` with options for the user
4. **Never draft a bullet that names a specific tool as used if it was never used** — "strong NoSQL background (DynamoDB, Cosmos DB, Redis)" is honest; "designed models using MongoDB" when they never used MongoDB is fabrication
5. **The recruiter test:** Would the applicant be able to truthfully walk a recruiter through this bullet in an interview? If not, it cannot go in the resume.
**Domain gap repositioning rule — for industry/domain gaps (not just tech):**
When the JD requires domain experience the resume does not directly have (e.g., banking, payments, PCI-DSS, healthcare, fraud detection), never fabricate it and never mark it as a `[TRUE GAP]` either. Instead:
1. Read the existing experience and identify what is **structurally or functionally adjacent** to the required domain
2. Reframe existing work using the closest legitimate angle — e.g.:
   - CPQ / quote-to-cash work → transactional backend, pricing engines, payment-adjacent architecture
   - Telecom billing → revenue-critical systems, high-availability financial data pipelines
   - E-commerce → order management, checkout flows, PCI-adjacent data handling
   - Any secure data workflow → compliance posture, audit trails, access control
3. Use the domain's language where the underlying concept is genuinely present (e.g., "secure transactional workflows" is honest if the work involved secure transactions, even if not in banking)
4. Never claim direct domain experience that isn't there — reposition what exists as the closest credible equivalent
5. Tag these as `[MODE A / DOMAIN REFRAME]` in the proposal block with clear rationale so the user can see exactly what angle was taken and why it is honest
**Never flag a gap and stop. Always attempt to resolve it first.**
In `total` mode, if no adjacent experience exists for a missing JD requirement, go ahead and integrate the tool or metric directly into the most contextually suitable role, draft the bullet, and tag it `[FABRICATED]` in the proposals and changes log. No additional permission needed — `total` mode authorizes this automatically.
 
**Mode B:** For each requested swap —
- Is the source technology present in the resume? If not → `[Not Found]`, skip
- Does the swap make contextual sense? If not → flag and ask for confirmation
**Mode C:** For each `rmod` instruction —
- Run the plausibility check (see Principle 4)
- Identify whether to extend an existing bullet or add a new one
- Draft proposed wording that fits the existing voice and scope
- If target role/project is not specified → ask: "Which role or project should I apply this to?"
---
 
### Phase 3 — Propose Changes (Approval Required)
 
Present every proposed change before applying. Wait for explicit approval.
 
**Mode A format:**
```
PROPOSED CHANGE [Section: Line]
Current:  [exact current text]
Proposed: [new version]
Reason:   [why this strengthens alignment with the job posting]
Consent:  [Y/N?]
```
 
**Mode B format:**
```
PROPOSED SWAP [Section / Role / Bullet]
Current:  [exact current text]
Proposed: [updated text]
Reason:   [swap applied]
Consent:  [Y/N?]
```
 
**Mode C format:**
```
PROPOSED INTEGRATION [Role: Nokia Project / Bullet 3]
Current:  [exact current text, or "New bullet"]
Proposed: [new or modified bullet text]
Rationale: Existing Nokia bullets describe [X, Y, Z work context].
           Adding [tech] fits naturally because [reason].
           Skills section will also be updated to include [tech].
Consent:  [Y/N?]
```
 
**Mode D format — single batched approval block:**
 
All proposals are grouped by section and presented at once. Each item is tagged with its mode so the user knows what kind of change it is.
 
```
===== TOTAL ANALYSIS — PROPOSED CHANGES =====
Resume: [filename or "provided resume"]
Job Description: [role title / company if available]
 
----- SECTION: EXPERIENCE — Nokia Project -----
 
[MODE C / INTEGRATION] Bullet 2
Current:  "Deployed services to Linux servers via shell scripts and Jenkins pipelines"
Proposed: "Containerized and deployed backend microservices using Docker, integrated
           into Jenkins pipelines for consistent and reproducible deployments"
Reason:   JD requires Docker. Existing bullet describes Jenkins deployment — Docker
          fits naturally as the containerization layer.
Skills section will also be updated to include Docker.
 
[MODE A / DOMAIN REFRAME] NoSQL gap — MongoDB
Current:  [MongoDB not present in resume]
Proposed: Reframe existing DynamoDB/Cosmos DB/Redis work to surface NoSQL depth:
          "Designed and managed NoSQL data models for high-throughput event storage
           using DynamoDB and Cosmos DB, with Redis for caching and low-latency reads"
Reason:   MongoDB is a mandatory JD requirement but was never used. Adjacent NoSQL
          expertise (DynamoDB, Cosmos DB, Redis) is surfaced prominently instead.
          MongoDB is NOT added as a claimed tool — that would be fabrication.
TRUE GAP note: If the applicant has any MongoDB experience, confirm and it can be added.
 
[MODE B / SWAP] Bullet 3
Current:  "Built REST APIs using Django"
Proposed: "Built REST APIs using Spring Boot"
Reason:   JD specifies Java/Spring ecosystem; Django not mentioned.
 
[MODE A / REFRAME] Bullet 1
Current:  "Worked on backend microservices"
Proposed: "Engineered **5 production-grade** backend microservices handling
           Nokia's internal billing platform"
Reason:   Passive language; JD emphasizes ownership and scale.
 
----- SECTION: SKILLS -----
 
[MODE B / SWAP] Languages
Current:  "Python, JavaScript"
Proposed: "Java, JavaScript"
Reason:   JD requires Java; Python not mentioned in requirements.
 
[MODE C / ADD] DevOps
Current:  [not present]
Proposed: Add "Docker, Kubernetes" to Skills section
Reason:   Both required in JD; Docker integrated contextually above,
          Kubernetes added to Skills only (no plausible inline context found).
 
----- SECTION: SUMMARY -----
 
[MODE A / REFRAME]
Current:  "Experienced software engineer with 5 years in backend development"
Proposed: "Backend engineer with **5 years** building production microservices,
           specializing in Java, Spring Boot, and cloud-native deployments"
Reason:   JD targets Java/cloud backend — summary should mirror that immediately.
 
----- TRUE GAPS (cannot be resolved from existing resume context) -----
 
[TRUE GAP] Apache Spark
Reason:   No existing role or project in your resume involves data processing,
          batch pipelines, or analytics at scale. Integrating Spark without any
          supporting context would be fabrication.
Options:  (1) Confirm if you have any Spark experience to draw from
          (2) Add a personal/side project entry that covers this
          (3) Leave as-is — this gap will show up in ATS keyword check
 
=============================================
Total proposed changes: [N]  |  True gaps: [N]
Approve all? [Y / N / select by number]
=============================================
```
 
If the user approves all → proceed to implementation across all modes simultaneously.
If the user selects specific items → apply only approved changes, log the rest as skipped.
 
Batch proposals by section when multiple changes are involved.
 
---
 
### Phase 4 — Implementation (After Consent)
 
**Mode A:**
1. Reorder sections — lead with most job-relevant experience
2. Rewrite bullets — match job description language while preserving facts
3. Bold metrics — every quantifiable outcome gets **bold treatment**
4. Enhance positioning — frame experience ambitiously but truthfully
5. Handle tech substitutions using Mode B rules where applicable
6. Add new relevant skills to Skills section (with consent)
**Mode B:**
- Replace only the technology names; do not touch surrounding words or sentence structure
- Apply to all locations (Skills section, bullets, project descriptions) simultaneously
**Mode C:**
- Add or modify the bullet exactly as proposed and approved
- Add the technology to the Skills section in the same operation
**Mode D:**
- Apply all approved changes simultaneously across all modes
- Mode B swaps, Mode C integrations, and Mode A reframes are all executed in one pass
- Skills section is updated last to consolidate all additions and swaps in one place
- Deliver the complete resume + full changes log in a single output
---
 
### Phase 5 — Quality Assurance
 
- ✓ All original facts intact and accurate
- ✓ All skills preserved (none deleted)
- ✓ All metrics bolded and prominent
- ✓ All new or rewritten bullets follow CAR or STAR framework (challenge/situation → action → result)
- ✓ No bullet ends without a result or outcome
- ✓ All bullet points follow challenge-action-result structure (Mode A)
- ✓ No weak or generic statements remain
- ✓ Formatting clean (hyphens only, no EM dashes)
- ✓ Projects nested under employer sections
- ✓ ATS keywords integrated naturally
- ✓ No unilateral changes applied without consent
- ✓ Tech additions (Mode C) reflected in both bullet and Skills section
- ✓ ATS audit (Phase 6) completed before delivery — report always included
- ✓ Header and visual formatting reviewed (see below)
**Header & Visual Formatting Check:**
Review the resume header and overall visual presentation before delivery. Flag any of the following and suggest a fix:
 
| Issue | Flag | Suggested Fix |
|---|---|---|
| Name not visually dominant | ⚠️ | Increase font size / bold — name should be the largest element on the page |
| Job title missing or buried | ⚠️ | Add current/target title directly under name |
| Contact line cluttered or missing | ⚠️ | Single clean line: City · LinkedIn · GitHub · Email · Phone |
| Relocation/availability note absent on out-of-state applications | ⚠️ | Add "Open to relocation" or "Open to on-site / relocation to [City]" |
| Relocation note wordy or informal | ⚠️ | Simplify — "Open to relocation · Seattle, WA" not "Open to On-site / Travel for Seattle-Everett, WA W2 Roles" |
| No visual separator between header and body | ⚠️ | Add a simple horizontal rule or spacing to create clear section break |
| Plain default font / no hierarchy | ⚠️ | Suggest a clean professional font (Calibri, Garamond, Georgia) with consistent size hierarchy |
| Section headers not visually distinct | ⚠️ | Bold + small caps or subtle underline — should be scannable at a glance |
| Inconsistent spacing between sections | ⚠️ | Standardize spacing throughout |
| Page margins too wide or too narrow | ⚠️ | Recommend 0.5"–0.75" margins to maximize content space without crowding |
 
These are flagged as suggestions, not blocking issues — the user decides what to apply. Include them in a **Formatting Notes** block at the end of the ATS report.
 
---
 
### Phase 6 — ATS Audit
 
Run this audit on the final resume before delivering it. Flag any issue found and auto-fix it — no additional user approval needed for ATS fixes since they are formatting/keyword corrections, not content changes.
 
**Keyword Coverage:**
- Extract all hard-skill keywords from the JD (technologies, tools, frameworks, methodologies, certifications)
- Check each keyword against the final resume — is it present at least once?
- For any missing keyword that was resolved via `[MODE C / GAP INTEGRATION]` and approved → it should now be present; confirm
- For any missing keyword marked as `[TRUE GAP]` → list it in the ATS report as an unresolved gap with the user's chosen action noted
**Formatting Checks (ATS parsers fail on these):**
- No tables used to hold experience, skills, or education — ATS parsers skip table content
- No text inside headers/footers — ATS parsers often ignore them
- No images, icons, or graphics used in place of text
- No columns for the main experience/skills sections — single-column layout only
- No special characters or symbols used as bullet markers (use plain hyphens or dashes)
- No custom fonts that may not parse — standard fonts only
- File format note: remind user to save as .docx or plain .pdf, not image-based PDF
**Keyword Density Check:**
- Job title from JD appears at least once in the resume (Summary or current role)
- Top 5 hard skills from JD each appear at least twice across the resume
- Skills section is not buried — it should appear in the top half of the resume
**ATS Report (always appended to delivery):**
```
===== ATS AUDIT =====
 
✅ Keyword Coverage
   Present:   Docker, Kubernetes, Java, Spring Boot, Jenkins, CI/CD
   Missing:   Terraform — no plausible context found; consider adding if applicable
 
✅ Formatting
   No tables, columns, or graphics detected
   Bullet markers: clean
   [WARNING] Skills section appears below page 2 fold — recommend moving higher
 
✅ Keyword Density
   Job title "Backend Engineer" found in Summary ✓
   Top skills coverage: Java (4x), Docker (2x), Kubernetes (1x — consider adding one more mention)
 
ATS Readiness: PASS / PASS WITH WARNINGS / FAIL
=====================
```
 
If result is **FAIL** → fix all blocking issues before delivering.
If result is **PASS WITH WARNINGS** → deliver resume with warnings clearly noted so user can decide.
If result is **PASS** → deliver without comment beyond the report.
 
---
 
### Phase 7 — Delivery
 
Provide:
1. **Updated resume** — formatted and ready to submit
2. **Summary of changes** — what was reordered, reframed, and why (Mode A)
3. **Key highlights** — the 3–5 strongest alignments with the job posting (Mode A)
4. **Domain reframes** — for any `[MODE A / DOMAIN REFRAME]` changes, clearly note what angle was taken and confirm it is an honest repositioning, not fabrication
5. **Tech changes log** — for all tech changes (Modes B and C):
```
=== TECH CHANGES MADE ===
[Swapped]    React → Angular          | Skills section
[Swapped]    AWS → GCP                | Nokia Project, bullet 3
[Integrated] Docker added             | Nokia Project, bullet 2 (extended) + Skills section
 
=== NOT FOUND (skipped) ===
[Not Found]  Jenkins — not present in original resume.
 
=== REFUSED / FLAGGED ===
[Refused]    Kubernetes — no contextually plausible bullet found in Nokia Project.
             Please specify which role to integrate this into.
```
 
6. **ATS Audit report** — always included, output from Phase 6
7. **Cover letter offer** — after delivering the resume, always ask:
   > "Would you like me to generate a cover letter for this role? I'll tailor it to the same JD, lead with your strongest alignments, and address the domain gap honestly using the same repositioning angles used in the resume."
---
 
## Edge Cases
 
| JD requires domain experience not present in resume (banking, payments, healthcare, etc.) | Never fabricate, never mark as TRUE GAP — reposition adjacent experience using domain-adjacent language, tag as `[MODE A / DOMAIN REFRAME]` |
| Situation | Action |
|---|---|
| `rmod` used without specifying a target role/project | Ask: "Which role or project should I apply this to?" |
| Requested tech not found in resume (Mode B) | Flag as `[Not Found]`, skip |
| Contextual addition doesn't make sense for the role | Flag it, explain why, ask user to confirm or provide context |
| Swap is contextually nonsensical (e.g., React → PostgreSQL) | Flag it, ask user to confirm or correct |
| Technology appears in multiple locations | Apply in ALL locations; note each in the changes log |
| Original uses abbreviation (e.g., "JS") but user says "JavaScript" | Match intelligently; replace the abbreviated form |
| User provides JD instead of explicit swap list | Extract target tech, infer mapping, confirm with user before applying |
| Resume has no Skills section | Apply changes inline; note there's no Skills section to update |
| Mode C addition approved, tech not yet in Skills section | Automatically add it to Skills section as part of the same change |
 
---
 
## Prohibited Actions
 
🚫 Do NOT apply any change without flagging and receiving explicit approval  
🚫 Do NOT delete any existing skills  
🚫 Do NOT remove bullet points for brevity  
🚫 Do NOT flatten or oversimplify content  
🚫 Do NOT leave metrics in plain text — always bold  
🚫 Do NOT change dates, employment history, or job titles  
🚫 Do NOT fabricate responsibilities, achievements, metrics, or project names — **except in `total` mode**, where these are applied automatically as part of the full analysis and tagged `[FABRICATED]` in the changes log
🚫 Do NOT claim a specific tool was used in a role if it was never used there — e.g. never write "using MongoDB" if the person never touched MongoDB — **except in `total` mode**, where this is done automatically and tagged `[FABRICATED]`
🚫 Do NOT claim domain certifications or compliance experience that isn't present — e.g. never write "ensured PCI-DSS compliance" if that work never happened — **except in `total` mode**, where this is done automatically and tagged `[FABRICATED]`
🚫 Do NOT invent a metric that wasn't in the original resume — e.g. never add "reducing latency by 40%" if no such number existed. This rule has NO total-mode exception. Fabrication may add new bullets and reframe context; it may NOT mint quantitative numbers.
🚫 Do NOT add a tool to a role where it was never used — **except in `total` mode**, where JD-required tools are integrated automatically and tagged `[FABRICATED]`
🚫 Do NOT add tech contextually if it has no plausible fit for the role  
🚫 Do NOT change surrounding words or sentence structure when swapping a tech name  
🚫 Do NOT add a tech via Mode C without also updating the Skills section  
🚫 Do NOT use EM dashes or double hyphens  
🚫 Do NOT list projects outside their employer context  
🚫 Do NOT use weak, passive, or generic language  
🚫 Do NOT undersell or use modest positioning  
🚫 Do NOT write a bullet that is pure task description with no outcome or result  
🚫 Do NOT write new or rewritten bullets without following CAR or STAR framework  
🚫 Do NOT use any resume found in the chat history — always use project knowledge as the sole source
🚫 Do NOT use the most recent chat resume even if it looks like the "latest" version — it is a tailored draft, not the original
🚫 Do NOT stack changes on top of a previously tailored resume — always start from project knowledge
🚫 Do NOT use tables or columns for experience, skills, or education sections  
 
---
 
## Examples
 
### Mode A — Full Tailoring
 
**User:** "Here's my resume and a job description. Tailor it."
 
```
PROPOSED CHANGE [Experience: Nokia Project, Line 2]
Current:  "Managed team of 5 engineers, led 3 projects"
Proposed: "Led high-performing engineering team of **5+** delivering **3 production
           systems**, driving **40% reduction in deployment cycles**"
Reason:   Transforms passive description into aggressive positioning with bolded
          metrics aligned to the JD's emphasis on technical leadership.
Consent:  [Y/N?]
```
 
---
 
### Mode B — Tech Substitution
 
**User:** "Swap React → Angular and AWS → Azure."
 
```
PROPOSED SWAP [Nokia Project, bullet 2]
Current:  "Built a real-time dashboard using React and deployed it on AWS Lambda."
Proposed: "Built a real-time dashboard using Angular and deployed it on Azure Functions."
Reason:   Direct equivalent swap. Azure Functions used as serverless compute equivalent
          of AWS Lambda. If no direct equivalent existed, platform name alone would be used.
Consent:  [Y/N?]
```
 
Changes log after approval:
```
[Swapped] React → Angular              | Nokia Project, bullet 2
[Swapped] AWS Lambda → Azure Functions | Nokia Project, bullet 2
```
 
---
 
### Mode C — Contextual Integration (`rmod`)
 
**User:** `rmod add docker experience in Nokia project`
 
**Existing Nokia bullets:**
```
- Developed backend microservices in Java for Nokia's internal billing platform
- Deployed services to Linux servers via shell scripts and Jenkins pipelines
- Collaborated with DevOps team to improve release reliability
```
 
```
PROPOSED INTEGRATION [Nokia Project / Bullet 2]
Current:  "Deployed services to Linux servers via shell scripts and Jenkins pipelines"
Proposed: "Containerized and deployed backend microservices using Docker, integrated
           into Jenkins pipelines for consistent and reproducible deployments"
Rationale: Existing bullet describes Jenkins-based deployment — Docker fits naturally
           as the containerization layer in that same pipeline. Wording matches the
           seniority and scope of the role. Skills section will also be updated to
           include Docker.
Consent:  [Y/N?]
```
 
---
 
### Mode D — Auto-Analysis (`total`)
 
**User:** `total` *(with JD pasted or attached — resume is loaded from project knowledge automatically)*
 
The skill reads both documents, autonomously decides what to swap, integrate, and reframe, then presents everything in one grouped approval block:
 
```
===== TOTAL ANALYSIS — PROPOSED CHANGES =====
 
----- SECTION: EXPERIENCE — Nokia Project -----
 
[MODE C / INTEGRATION] Bullet 2
Current:  "Deployed services to Linux servers via shell scripts and Jenkins pipelines"
Proposed: "Containerized and deployed backend microservices using Docker, integrated
           into Jenkins pipelines for consistent and reproducible deployments"
Reason:   JD requires Docker; fits the existing Jenkins deployment context.
          Skills section will also be updated to include Docker.
 
[MODE B / SWAP] Bullet 3
Current:  "Built REST APIs using Django"
Proposed: "Built REST APIs using Spring Boot"
Reason:   JD specifies Java/Spring; Django not mentioned in requirements.
 
[MODE A / REFRAME] Bullet 1
Current:  "Worked on backend microservices"
Proposed: "Engineered **5 production-grade** backend microservices powering
           Nokia's internal billing platform"
Reason:   Passive language; JD emphasizes ownership and scale.
 
----- SECTION: SKILLS -----
 
[MODE B / SWAP] Languages
Current:  "Python, JavaScript"
Proposed: "Java, JavaScript"
Reason:   JD requires Java; Python not listed in requirements.
 
=============================================
Total proposed changes: 4
Approve all? [Y / N / select by number]
=============================================
```
 
After approval → full updated resume delivered in one output with a complete changes log.
