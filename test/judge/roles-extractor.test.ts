import { describe, expect, it } from "vitest";

import { extractRolesFromCanonicalTex } from "@/judge/roles-extractor";

describe("extractRolesFromCanonicalTex", () => {
  it("includes role headers and project sub-header sections", () => {
    const tex = String.raw`
\section*{EXPERIENCE}
\textbf{Hitachi Vantara} \hfill Jan 2020 -- Present\\
\textit{Senior Software Engineer}
\vspace{2pt}
\hspace{4mm}\textbf{Project: Nokia}
\begin{itemize}
\item Drove a \textbf{55\% latency reduction} by optimizing Cosmos DB queries.
\item Built Spring Boot microservices across Azure Service Bus integrations.
\end{itemize}

\textbf{AquilaEdge LLC} \hfill Jan 2019 -- Dec 2019\\
\textit{Software Engineer}
\begin{itemize}
\item Delivered Flutter dashboards for healthcare workflows.
\end{itemize}
\section*{SKILLS}
Java
`;

    const roles = extractRolesFromCanonicalTex(tex);

    expect(roles).toContain("## Hitachi Vantara - Senior Software Engineer (Jan 2020 -- Present)");
    expect(roles).toContain("## Project: Nokia (under Hitachi Vantara)");
    expect(roles).toContain("  - Drove a 55% latency reduction by optimizing Cosmos DB queries.");
    expect(roles).toContain("  - Built Spring Boot microservices across Azure Service Bus integrations.");
    expect(roles).toContain("## AquilaEdge LLC - Software Engineer (Jan 2019 -- Dec 2019)");
    expect(roles).toContain("  - Delivered Flutter dashboards for healthcare workflows.");
  });
});
