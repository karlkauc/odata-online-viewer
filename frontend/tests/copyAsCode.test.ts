import { describe, expect, it } from "vitest";
import { SNIPPET_LABELS, snippet, type SnippetLanguage } from "../src/lib/copyAsCode";

const URL = "https://svc.example/odata/People?$filter=Name eq 'O''Neil'&$top=5";
const languages = Object.keys(SNIPPET_LABELS) as SnippetLanguage[];

describe("copy as code", () => {
  it("quotes the URL safely in every language", () => {
    expect(snippet("curl", { url: URL, basicAuth: false, v4: true })).toContain(`'https://svc.example/odata/People?$filter=Name eq '\\''O'\\'''\\''Neil'\\''&$top=5'`);
    expect(snippet("powerquery", { url: 'https://x/"q"', basicAuth: false, v4: true })).toContain('OData.Feed("https://x/""q""", null, [Implementation = "2.0"])');
    expect(snippet("python", { url: URL, basicAuth: false, v4: true })).toContain(JSON.stringify(URL));
  });

  it("uses placeholders, never real credentials", () => {
    for (const language of languages) {
      const code = snippet(language, { url: URL, basicAuth: true, v4: false });
      if (language !== "powerquery") expect(code).toContain("USER");
      expect(code).not.toMatch(/secret/i);
    }
    for (const language of languages) expect(snippet(language, { url: URL, basicAuth: false, v4: true })).not.toContain("PASSWORD");
  });

  it("only asks Power Query for the V4 implementation on V4 services", () => {
    expect(snippet("powerquery", { url: URL, basicAuth: false, v4: false })).not.toContain("Implementation");
  });
});
