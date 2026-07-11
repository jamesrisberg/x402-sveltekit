import type { RequestEvent } from "@sveltejs/kit";
import type { HTTPAdapter } from "@x402/core/server";

/**
 * HTTP adapter for SvelteKit request events
 */
export class SvelteKitAdapter implements HTTPAdapter {
  private event: RequestEvent;

  /**
   * Creates a new SvelteKitAdapter instance.
   *
   * @param event - The SvelteKit request event
   */
  constructor(event: RequestEvent) {
    this.event = event;
  }

  /**
   * Gets a header value from the request.
   *
   * @param name - The header name
   * @returns The header value or undefined
   */
  getHeader(name: string): string | undefined {
    return this.event.request.headers.get(name) ?? undefined;
  }

  /**
   * Gets the HTTP method of the request.
   *
   * @returns The HTTP method
   */
  getMethod(): string {
    return this.event.request.method;
  }

  /**
   * Gets the path of the request.
   *
   * @returns The request path
   */
  getPath(): string {
    return this.event.url.pathname;
  }

  /**
   * Gets the full URL of the request.
   *
   * @returns The full request URL
   */
  getUrl(): string {
    return this.event.url.href;
  }

  /**
   * Gets the Accept header from the request.
   *
   * @returns The Accept header value or empty string
   */
  getAcceptHeader(): string {
    return this.getHeader("accept") || "";
  }

  /**
   * Gets the User-Agent header from the request.
   *
   * @returns The User-Agent header value or empty string
   */
  getUserAgent(): string {
    return this.getHeader("user-agent") || "";
  }

  /**
   * Gets all query parameters from the request URL.
   *
   * @returns Record of query parameter key-value pairs
   */
  getQueryParams(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const key of this.event.url.searchParams.keys()) {
      const values = this.event.url.searchParams.getAll(key);
      result[key] = values.length > 1 ? values : values[0];
    }
    return result;
  }

  /**
   * Gets a specific query parameter by name.
   *
   * @param name - The query parameter name
   * @returns The query parameter value(s) or undefined
   */
  getQueryParam(name: string): string | string[] | undefined {
    const values = this.event.url.searchParams.getAll(name);
    if (values.length === 0) {
      return undefined;
    }
    return values.length > 1 ? values : values[0];
  }

  /**
   * Gets the parsed request body.
   * The request is cloned so the route handler can still read it.
   *
   * @returns The parsed request body
   */
  async getBody(): Promise<unknown> {
    try {
      return await this.event.request.clone().json();
    } catch {
      return undefined;
    }
  }
}
