/**
 * answer-concerns.ts — Deterministic resolver for judge "concerns" strings.
 *
 * Maps each free-text concern raised by the judge to a profile/job-grounded
 * answer and a status (resolved / confirmed_gap / unknown). No LLM calls — pure
 * string + numeric comparison so it is cheap, stable, and auditable.
 */

export interface ConcernAnswer {
  concern: string;
  answer: string;
  status: "resolved" | "confirmed_gap" | "unknown";
}

interface AnswerProfile {
  skills?: string[];
  years_experience?: number;
  work_authorization?: string;
  target_compensation?: number;
}

interface AnswerJob {
  required_skills?: { name: string; importance: string }[];
  years_experience?: number | null;
  visa_sponsorship?: string | null;
  compensation_min?: number | null;
  compensation_max?: number | null;
}

const lc = (s: string): string => s.toLowerCase();

function extractSkillFromConcern(concern: string): string | null {
  const m1 = concern.match(/no\s+(.+?)\s+experience/i);
  if (m1) return m1[1].trim();
  const m2 = concern.match(/(.+?)\s+is\s+required\s+but/i);
  if (m2) return m2[1].trim();
  return null;
}

export function answerConcerns(
  concerns: string[],
  profile: AnswerProfile,
  job: AnswerJob,
): ConcernAnswer[] {
  const profileSkills = (profile.skills ?? []).map(lc);

  return concerns.map((concern): ConcernAnswer => {
    const c = lc(concern);

    const skill = extractSkillFromConcern(concern);
    if (skill) {
      const present = profileSkills.some(
        s => s.includes(lc(skill)) || lc(skill).includes(s),
      );
      return present
        ? { concern, answer: `Present in profile skills: ${skill}`, status: "resolved" }
        : { concern, answer: `Confirmed skill gap: ${skill} not in profile`, status: "confirmed_gap" };
    }

    if (c.includes("yoe") || c.includes("years") || c.includes("experience")) {
      const have = profile.years_experience;
      const need = job.years_experience;
      if (have != null && need != null) {
        return have >= need
          ? { concern, answer: `Profile has ${have} YOE vs job's ${need} required — met.`, status: "resolved" }
          : { concern, answer: `Profile has ${have} YOE vs job's ${need} required — short by ${need - have}.`, status: "confirmed_gap" };
      }
      if (have != null) {
        return { concern, answer: `Profile has ${have} YOE; job did not state a numeric minimum.`, status: "resolved" };
      }
      return { concern, answer: "Requires manual review.", status: "unknown" };
    }

    if (c.includes("visa") || c.includes("sponsorship") || c.includes("opt")) {
      const auth = profile.work_authorization ?? "unspecified";
      const sp = job.visa_sponsorship ?? "unmentioned";
      if (lc(sp) === "denied") {
        return { concern, answer: `Work auth: ${auth}; job denies sponsorship.`, status: "confirmed_gap" };
      }
      return { concern, answer: `Work auth: ${auth}; job sponsorship: ${sp}.`, status: "resolved" };
    }

    if (c.includes("salary") || c.includes("compensation") || c.includes("comp")) {
      if (job.compensation_min != null) {
        const range = job.compensation_max != null
          ? `${job.compensation_min}–${job.compensation_max}`
          : `${job.compensation_min}+`;
        return { concern, answer: `Job comp range ${range}; passed pre-filter, acceptable.`, status: "resolved" };
      }
      return { concern, answer: "Compensation not stated by job; passed pre-filter.", status: "resolved" };
    }

    return { concern, answer: "Requires manual review.", status: "unknown" };
  });
}
