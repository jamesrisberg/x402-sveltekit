import { describe, it, expect } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { SvelteKitAdapter } from "./adapter";

/**
 * Creates a mock SvelteKit RequestEvent for testing.
 *
 * @param url - The full request URL.
 * @param init - Request init options (method, headers, body).
 * @returns A mock RequestEvent.
 */
function createEvent(url: string, init: RequestInit = {}): RequestEvent {
  return {
    request: new Request(url, init),
    url: new URL(url),
  } as RequestEvent;
}

describe("SvelteKitAdapter", () => {
  it("returns header values and undefined for missing headers", () => {
    const adapter = new SvelteKitAdapter(
      createEvent("https://example.com/api/test", {
        headers: { "payment-signature": "sig123" },
      }),
    );

    expect(adapter.getHeader("payment-signature")).toBe("sig123");
    expect(adapter.getHeader("x-payment")).toBeUndefined();
  });

  it("returns method, path, and full URL", () => {
    const adapter = new SvelteKitAdapter(
      createEvent("https://example.com/api/test?foo=bar", { method: "POST", body: "{}" }),
    );

    expect(adapter.getMethod()).toBe("POST");
    expect(adapter.getPath()).toBe("/api/test");
    expect(adapter.getUrl()).toBe("https://example.com/api/test?foo=bar");
  });

  it("returns empty string for missing Accept and User-Agent headers", () => {
    const adapter = new SvelteKitAdapter(createEvent("https://example.com/"));

    expect(adapter.getAcceptHeader()).toBe("");
    expect(adapter.getUserAgent()).toBe("");
  });

  it("returns Accept and User-Agent header values", () => {
    const adapter = new SvelteKitAdapter(
      createEvent("https://example.com/", {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
      }),
    );

    expect(adapter.getAcceptHeader()).toBe("text/html");
    expect(adapter.getUserAgent()).toBe("Mozilla/5.0");
  });

  it("returns query params, collapsing single values and keeping repeated values as arrays", () => {
    const adapter = new SvelteKitAdapter(createEvent("https://example.com/api?a=1&b=2&b=3"));

    expect(adapter.getQueryParams()).toEqual({ a: "1", b: ["2", "3"] });
    expect(adapter.getQueryParam("a")).toBe("1");
    expect(adapter.getQueryParam("b")).toEqual(["2", "3"]);
    expect(adapter.getQueryParam("missing")).toBeUndefined();
  });

  it("parses a JSON body without consuming the original request", async () => {
    const event = createEvent("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: { "content-type": "application/json" },
    });
    const adapter = new SvelteKitAdapter(event);

    expect(await adapter.getBody()).toEqual({ hello: "world" });
    // The route handler must still be able to read the body
    expect(await event.request.json()).toEqual({ hello: "world" });
  });

  it("returns undefined for a non-JSON body", async () => {
    const adapter = new SvelteKitAdapter(
      createEvent("https://example.com/api", { method: "POST", body: "not json" }),
    );

    expect(await adapter.getBody()).toBeUndefined();
  });
});
