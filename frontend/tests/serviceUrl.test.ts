import { describe, expect, it } from "vitest";
import { splitCredentials, urlOrigin } from "../src/lib/serviceUrl";

describe("urlOrigin", () => {
  it("reads scheme, host and port the way the backend does", () => {
    expect(urlOrigin("https://svc.example/odata/")).toBe("https://svc.example");
    expect(urlOrigin("svc.example/odata/")).toBe("https://svc.example");
    expect(urlOrigin("http://svc.example:8080/x")).toBe("http://svc.example:8080");
    expect(urlOrigin("")).toBeNull();
  });
});

describe("splitCredentials", () => {
  it("moves user:password@ out of the URL", () => {
    expect(splitCredentials("https://bob:s%40cret@svc.example/odata/")).toEqual({
      url: "https://svc.example/odata/",
      username: "bob",
      password: "s@cret",
    });
    expect(splitCredentials("https://svc.example/odata/")).toBeNull();
    expect(splitCredentials("svc.example/odata/")).toBeNull();
  });
});
