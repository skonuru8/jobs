import { stripLatex } from "./resume";

export interface ResumeBrief {
  summary_metrics: string[];
  recent_roles: string[];
  flagship_projects: string[];
}

/**
 * Compact structured summary for cover-letter LLM (replaces full canonical TeX).
 */
export function buildResumeBriefFromCanonicalTex(tex: string): ResumeBrief {
  const plain = stripLatex(tex);

  const summaryMetrics: string[] = [];
  const sumMatch = plain.match(/SUMMARY([\s\S]*?)(?=SKILLS|EXPERIENCE|PROJECTS|$)/i);
  if (sumMatch) {
    const bullets = sumMatch[1].split(/\n/).map(l => l.replace(/^[\s•·\-–]+/, "").trim()).filter(Boolean);
    for (const b of bullets) {
      if (/\d|%|reduction|latency|GB|microservices|deployment/i.test(b) && b.length < 220) {
        summaryMetrics.push(b);
      }
      if (summaryMetrics.length >= 5) break;
    }
  }

  const recentRoles: string[] = [];
  const expMatch = plain.match(/EXPERIENCE([\s\S]*?)(?=PROJECTS|EDUCATION|AWARDS|$)/i);
  if (expMatch) {
    const lines = expMatch[1].split(/\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.length < 8 || line.length > 160) continue;
      if (/project:/i.test(line)) continue;
      if (/\d{4}/.test(line) && /engineer|consultant|apprentice/i.test(line)) {
        recentRoles.push(line);
      }
      if (recentRoles.length >= 6) break;
    }
  }

  const flagshipProjects: string[] = [];
  const projMatch = plain.match(/PROJECTS([\s\S]*?)(?=EDUCATION|AWARDS|$)/i);
  if (projMatch) {
    const chunk = projMatch[1];
    const names = chunk.match(/(?:^|\n)\s*([A-Za-z0-9][A-Za-z0-9 \-]{2,40})\s*(?:\(|,|\n)/g);
    if (names) {
      for (const raw of names) {
        const n = raw.replace(/[\n(,]/g, "").trim();
        if (n.length > 2 && !/^item$/i.test(n)) flagshipProjects.push(n);
        if (flagshipProjects.length >= 5) break;
      }
    }
  }

  return {
    summary_metrics: summaryMetrics.slice(0, 5),
    recent_roles: recentRoles.slice(0, 6),
    flagship_projects: flagshipProjects.slice(0, 5),
  };
}
