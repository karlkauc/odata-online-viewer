// "Copy as …" snippets for a data-explorer request.
//
// Credentials are never put into a snippet: when the service needs them, the
// snippet carries USER / PASSWORD placeholders, so a pasted snippet in a ticket
// or chat cannot leak them.

export type SnippetLanguage = "curl" | "fetch" | "csharp" | "python" | "powerquery";

export const SNIPPET_LABELS: Record<SnippetLanguage, string> = {
  curl: "curl",
  fetch: "JavaScript fetch",
  csharp: "C# HttpClient",
  python: "Python requests",
  powerquery: "Power Query M",
};

export interface SnippetRequest {
  url: string;
  /** The service needs HTTP Basic credentials. */
  basicAuth: boolean;
  /** OData V4 (Power Query's 2.0 implementation only speaks V4). */
  v4: boolean;
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
// JSON string syntax is valid in JavaScript, C# (regular literals) and Python.
const cQuote = (s: string) => JSON.stringify(s);
const mQuote = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function snippet(language: SnippetLanguage, { url, basicAuth, v4 }: SnippetRequest): string {
  switch (language) {
    case "curl":
      return ["curl", ...(basicAuth ? ["-u 'USER:PASSWORD'"] : []), "-H 'Accept: application/json'", shellQuote(url)].join(" \\\n  ");
    case "fetch":
      return [
        `const response = await fetch(${cQuote(url)}, {`,
        "  headers: {",
        '    Accept: "application/json",',
        ...(basicAuth ? ['    Authorization: "Basic " + btoa("USER:PASSWORD"),'] : []),
        "  },",
        "});",
        "const data = await response.json();",
      ].join("\n");
    case "csharp":
      return [
        "using System.Net.Http.Headers;",
        "",
        "using var client = new HttpClient();",
        'client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));',
        ...(basicAuth
          ? [
              "client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(",
              '    "Basic", Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("USER:PASSWORD")));',
            ]
          : []),
        `var json = await client.GetStringAsync(${cQuote(url)});`,
      ].join("\n");
    case "python":
      return [
        "import requests",
        "",
        "response = requests.get(",
        `    ${cQuote(url)},`,
        '    headers={"Accept": "application/json"},',
        ...(basicAuth ? ['    auth=("USER", "PASSWORD"),'] : []),
        "    timeout=60,",
        ")",
        "response.raise_for_status()",
        "data = response.json()",
      ].join("\n");
    case "powerquery":
      return [
        ...(basicAuth ? ["// Power Query asks for the Basic credentials when the query first runs."] : []),
        "let",
        `    Source = OData.Feed(${mQuote(url)}${v4 ? ', null, [Implementation = "2.0"]' : ""})`,
        "in",
        "    Source",
      ].join("\n");
  }
}
