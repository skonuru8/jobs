import { describe, it, expect, vi } from "vitest";
import { extractText, fetchJobPage } from "@/fetcher/fetch";

// ---------------------------------------------------------------------------
// extractText — pure function, no network needed
// ---------------------------------------------------------------------------

describe("extractText", () => {

  it("strips script tags and content", () => {
    const html = `<p>Job description</p><script>alert('xss')</script><p>Apply now</p>`;
    const result = extractText(html);
    expect(result).toContain("Job description");
    expect(result).toContain("Apply now");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("<script");
  });

  it("strips style tags and content", () => {
    const html = `<style>.btn{color:red}</style><p>Senior Engineer</p>`;
    const result = extractText(html);
    expect(result).toContain("Senior Engineer");
    expect(result).not.toContain("color:red");
  });

  it("strips nav and footer boilerplate", () => {
    const html = `
      <nav><a href="/">Home</a><a href="/jobs">Jobs</a></nav>
      <p>We are looking for a Java developer with 5+ years experience.</p>
      <footer>© 2026 Company Inc.</footer>
    `;
    const result = extractText(html);
    expect(result).toContain("Java developer");
    expect(result).not.toContain("Home");
    expect(result).not.toContain("© 2026");
  });

  it("converts block tags to newlines", () => {
    const html = `<p>Line one</p><p>Line two</p><li>Item</li>`;
    const result = extractText(html);
    expect(result).toContain("Line one");
    expect(result).toContain("Line two");
    expect(result).toContain("Item");
    // should be separate lines not merged
    expect(result).toMatch(/Line one\nLine two/);
  });

  it("decodes HTML entities", () => {
    const html = `<p>React &amp; Angular, Java &gt; 8, &quot;Senior&quot;</p>`;
    const result = extractText(html);
    expect(result).toContain("React & Angular");
    expect(result).toContain("Java > 8");
    expect(result).toContain('"Senior"');
  });

  it("collapses excessive whitespace", () => {
    const html = `<p>  Java   Spring   Boot  </p>`;
    const result = extractText(html);
    expect(result).toBe("Java Spring Boot");
  });

  it("handles empty input", () => {
    expect(extractText("")).toBe("");
  });

  it("handles plain text (no html tags)", () => {
    const text = "Senior Java Engineer with 5+ years experience in Spring Boot.";
    expect(extractText(text)).toBe(text);
  });

  it("strips all remaining tags after block conversion", () => {
    const html = `<div class="job-desc"><span class="bold">Requirements:</span> Java, Spring</div>`;
    const result = extractText(html);
    expect(result).toContain("Requirements:");
    expect(result).toContain("Java, Spring");
    expect(result).not.toContain("<span");
    expect(result).not.toContain("class=");
  });

  it("does not collapse double newlines (paragraph separation preserved)", () => {
    const html = `<p>Responsibilities</p><p>Requirements</p>`;
    const result = extractText(html);
    // both paragraphs should be present and separated
    expect(result).toContain("Responsibilities");
    expect(result).toContain("Requirements");
  });

  it("collapses 3+ newlines to max 2", () => {
    const html = `<p>Section 1</p><p></p><p></p><p>Section 2</p>`;
    const result = extractText(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("real-world dice-like HTML snippet", () => {
    const html = `
      <html>
        <head><title>Java Developer - Dice</title></head>
        <body>
          <nav>Home | Jobs | Companies</nav>
          <header><h1>Dice Job Board</h1></header>
          <main>
            <h1>Senior Java Full Stack Developer</h1>
            <div class="job-desc">
              <p>We are seeking a <strong>Senior Java Full Stack Developer</strong> with 5+ years of experience.</p>
              <h2>Requirements</h2>
              <ul>
                <li>Java 11+, Spring Boot</li>
                <li>Angular or React</li>
                <li>AWS or Azure experience</li>
              </ul>
              <h2>Responsibilities</h2>
              <ul>
                <li>Design and develop microservices</li>
                <li>Collaborate with cross-functional teams</li>
              </ul>
            </div>
          </main>
          <footer>© 2026 Dice Holdings</footer>
          <script>window.analytics = {}</script>
        </body>
      </html>
    `;
    const result = extractText(html);
    expect(result).toContain("Senior Java Full Stack Developer");
    expect(result).toContain("Spring Boot");
    expect(result).toContain("Angular or React");
    expect(result).toContain("microservices");
    expect(result).not.toContain("Dice Holdings");  // footer stripped
    expect(result).not.toContain("Home | Jobs");    // nav stripped
    expect(result).not.toContain("window.analytics"); // script stripped
  });
});

// ---------------------------------------------------------------------------
// fetchJobPage — test error handling without real network calls
// ---------------------------------------------------------------------------

describe("fetchJobPage error handling", () => {

  it("returns error result for invalid URL", async () => {
    const result = await fetchJobPage("not-a-url");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Invalid URL/);
    expect(result.description_raw).toBe("");
  });

  it("returns error result on network failure", async () => {
    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchJobPage("https://example.com/job/123");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/Network error/);

    globalThis.fetch = originalFetch;
  });

  it("returns error result on 403", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" })
    );

    const result = await fetchJobPage("https://example.com/job/123");
    expect(result.status).toBe("error");
    expect(result.http_status).toBe(403);
    expect(result.error).toContain("403");

    globalThis.fetch = originalFetch;
  });

  it("returns ok result with extracted text on success", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        "<html><body><p>Senior Java Engineer</p><p>Spring Boot required</p></body></html>",
        { status: 200 }
      )
    );

    const result = await fetchJobPage("https://example.com/job/123");
    expect(result.status).toBe("ok");
    expect(result.http_status).toBe(200);
    expect(result.description_raw).toContain("Senior Java Engineer");
    expect(result.description_raw).toContain("Spring Boot required");
    expect(result.fetched_at).toBeTruthy();

    globalThis.fetch = originalFetch;
  });
});
