import type { Handle } from "@sveltejs/kit";
import {
  HTTPRequestContext,
  HTTPResponseInstructions,
  PaywallConfig,
  PaywallProvider,
  x402HTTPResourceServer,
  x402ResourceServer,
  RoutesConfig,
  FacilitatorClient,
  FacilitatorResponseError,
  getFacilitatorResponseError,
  SETTLEMENT_OVERRIDES_HEADER,
  SettlementOverrides,
  checkIfBazaarNeeded,
} from "@x402/core/server";
import { SchemeNetworkServer, Network } from "@x402/core/types";
import { SvelteKitAdapter } from "./adapter";

export { SvelteKitAdapter };
export {
  x402ResourceServer,
  x402HTTPResourceServer,
  RouteConfigurationError,
  SETTLEMENT_OVERRIDES_HEADER,
} from "@x402/core/server";

/**
 * Set settlement overrides on a response for partial settlement.
 * The handle will extract these before settlement and strip the header from the client response.
 *
 * @param response - The response returned by the protected route handler
 * @param overrides - Settlement overrides (e.g., { amount: "500" } for partial settlement)
 */
export function setSettlementOverrides(response: Response, overrides: SettlementOverrides): void {
  response.headers.set(SETTLEMENT_OVERRIDES_HEADER, JSON.stringify(overrides));
}

/**
 * Configuration for registering a payment scheme with a specific network
 */
export interface SchemeRegistration {
  /**
   * The network identifier (e.g., 'eip155:84532', 'solana:mainnet')
   */
  network: Network;

  /**
   * The scheme server implementation for this network
   */
  server: SchemeNetworkServer;
}

/**
 * Builds a normalized 502 response for facilitator boundary failures.
 *
 * @param error - The facilitator response error to surface
 * @returns A JSON 502 response
 */
function facilitatorErrorResponse(error: FacilitatorResponseError): Response {
  return jsonResponse({ error: error.message }, 502);
}

/**
 * Builds a JSON response.
 *
 * @param body - The JSON-serializable body
 * @param status - The HTTP status code
 * @returns A JSON response
 */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Builds a response from x402 HTTP response instructions.
 *
 * @param instructions - Status, headers, and body from the resource server
 * @returns A response carrying the instructions
 */
function instructionsToResponse(instructions: HTTPResponseInstructions): Response {
  const body = instructions.isHtml
    ? String(instructions.body ?? "")
    : JSON.stringify(instructions.body ?? {});
  return new Response(body, {
    status: instructions.status,
    headers: instructions.headers,
  });
}

/**
 * SvelteKit payment handle for x402 protocol (direct HTTP server instance).
 *
 * Use this when you need to configure HTTP-level hooks.
 *
 * @param httpServer - Pre-configured x402HTTPResourceServer instance
 * @param paywallConfig - Optional configuration for the built-in paywall UI
 * @param paywall - Optional custom paywall provider (overrides default)
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true)
 * @returns SvelteKit handle
 *
 * @example
 * ```typescript
 * import { paymentHandleFromHTTPServer, x402ResourceServer, x402HTTPResourceServer } from "@jamesrisberg/x402-sveltekit";
 *
 * const resourceServer = new x402ResourceServer(facilitatorClient)
 *   .register(NETWORK, new ExactEvmScheme());
 *
 * const httpServer = new x402HTTPResourceServer(resourceServer, routes)
 *   .onProtectedRequest(requestHook);
 *
 * export const handle = paymentHandleFromHTTPServer(httpServer);
 * ```
 */
export function paymentHandleFromHTTPServer(
  httpServer: x402HTTPResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): Handle {
  // Register custom paywall provider if provided
  if (paywall) {
    httpServer.registerPaywallProvider(paywall);
  }

  // Store initialization promise (not the result)
  // httpServer.initialize() fetches facilitator support and validates routes
  let initPromise: Promise<void> | null = syncFacilitatorOnStart ? httpServer.initialize() : null;
  let isInitialized = false;

  /**
   * Ensures facilitator initialization succeeds once, while allowing retries after failures.
   */
  async function initializeHttpServer(): Promise<void> {
    if (!syncFacilitatorOnStart || isInitialized) {
      return;
    }

    if (!initPromise) {
      initPromise = httpServer.initialize();
    }

    try {
      await initPromise;
      isInitialized = true;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  }

  let bazaarPromise: Promise<void> | null = null;
  if (checkIfBazaarNeeded(httpServer.routes)) {
    if (!httpServer.server.hasExtension("bazaar")) {
      bazaarPromise = import("@x402/extensions/bazaar").then(
        ({ bazaarResourceServerExtension }) => {
          httpServer.server.registerExtension(bazaarResourceServerExtension);
        },
      );
    }
    bazaarPromise = (bazaarPromise ?? Promise.resolve())
      .then(() => import("@x402/extensions/bazaar"))
      .then(({ validateBazaarRouteExtensions }) => {
        validateBazaarRouteExtensions(httpServer.routes);
      })
      .catch(err => {
        console.error("Failed to load bazaar extension:", err);
      });
  }

  return async ({ event, resolve }) => {
    // Create adapter and context
    const adapter = new SvelteKitAdapter(event);
    const context: HTTPRequestContext = {
      adapter,
      path: event.url.pathname,
      method: event.request.method,
      paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
    };

    // Check if route requires payment before initializing facilitator
    if (!httpServer.requiresPayment(context)) {
      return resolve(event);
    }

    // Only initialize when processing a protected route
    if (syncFacilitatorOnStart && !isInitialized) {
      try {
        await initializeHttpServer();
      } catch (error) {
        const facilitatorError = getFacilitatorResponseError(error);
        if (facilitatorError) {
          return facilitatorErrorResponse(facilitatorError);
        }
        throw error;
      }
    }

    // Await bazaar extension loading if needed
    if (bazaarPromise) {
      await bazaarPromise;
      bazaarPromise = null;
    }

    // Process payment requirement check
    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      result = await httpServer.processHTTPRequest(context, paywallConfig);
    } catch (error) {
      if (error instanceof FacilitatorResponseError) {
        return facilitatorErrorResponse(error);
      }
      throw error;
    }

    // Handle the different result types
    switch (result.type) {
      case "no-payment-required":
        // No payment needed, proceed directly to the route handler
        return resolve(event);

      case "payment-error":
        // Payment required but not provided or invalid
        return instructionsToResponse(result.response);

      case "payment-verified": {
        // Payment is valid, need to wrap response for settlement
        const { cancellationDispatcher, paymentPayload, paymentRequirements, declaredExtensions } =
          result;

        // Proceed to the route handler
        let response: Response;
        try {
          response = await resolve(event);
        } catch (error) {
          await cancellationDispatcher.cancel({
            reason: "handler_threw",
            error,
          });
          throw error;
        }

        // If the response from the protected route is >= 400, do not settle payment
        if (response.status >= 400) {
          await cancellationDispatcher.cancel({
            reason: "handler_failed",
            responseStatus: response.status,
          });
          return stripHeader(response, SETTLEMENT_OVERRIDES_HEADER);
        }

        // Get response body for extensions
        const responseBody = Buffer.from(await response.clone().arrayBuffer());

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        try {
          const settleResult = await httpServer.processSettlement(
            paymentPayload,
            paymentRequirements,
            declaredExtensions,
            { request: context, responseBody, responseHeaders },
          );

          if (!settleResult.success) {
            // Settlement failed - do not return the protected resource
            return instructionsToResponse(settleResult.response);
          }

          // Settlement succeeded - add headers to response
          const headers = new Headers(response.headers);
          Object.entries(settleResult.headers).forEach(([key, value]) => {
            headers.set(key, value);
          });
          headers.delete(SETTLEMENT_OVERRIDES_HEADER);
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        } catch (error) {
          if (error instanceof FacilitatorResponseError) {
            return facilitatorErrorResponse(error);
          }
          console.error(error);
          // If settlement fails, return an error response
          return jsonResponse({}, 402);
        }
      }
    }
  };
}

/**
 * Returns a response with the given header removed, rebuilding the response
 * if its headers are immutable.
 *
 * @param response - The response to strip the header from
 * @param name - The header name to remove
 * @returns The response without the header
 */
function stripHeader(response: Response, name: string): Response {
  if (!response.headers.has(name)) {
    return response;
  }
  try {
    response.headers.delete(name);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.delete(name);
    return new Response(response.body, { status: response.status, headers });
  }
}

/**
 * SvelteKit payment handle for x402 protocol (direct server instance).
 *
 * Use this when you want to pass a pre-configured x402ResourceServer instance.
 * This provides more flexibility for testing, custom configuration, and reusing
 * server instances across multiple handles.
 *
 * @param routes - Route configurations for protected endpoints
 * @param server - Pre-configured x402ResourceServer instance
 * @param paywallConfig - Optional configuration for the built-in paywall UI
 * @param paywall - Optional custom paywall provider (overrides default)
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true)
 * @returns SvelteKit handle
 *
 * @example
 * ```typescript
 * // src/hooks.server.ts
 * import { paymentHandle } from "@jamesrisberg/x402-sveltekit";
 *
 * const server = new x402ResourceServer(myFacilitatorClient)
 *   .register(NETWORK, new ExactEvmScheme());
 *
 * export const handle = paymentHandle(routes, server, paywallConfig);
 * ```
 */
export function paymentHandle(
  routes: RoutesConfig,
  server: x402ResourceServer,
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): Handle {
  // Create the x402 HTTP server instance with the resource server
  const httpServer = new x402HTTPResourceServer(server, routes);

  return paymentHandleFromHTTPServer(httpServer, paywallConfig, paywall, syncFacilitatorOnStart);
}

/**
 * SvelteKit payment handle for x402 protocol (config-based).
 *
 * Use this when you want the handle to construct the resource server from
 * facilitator clients and scheme registrations.
 *
 * @param routes - Route configurations for protected endpoints
 * @param facilitatorClients - One or more facilitator clients for payment verification and settlement
 * @param schemes - Optional payment scheme registrations
 * @param paywallConfig - Optional configuration for the built-in paywall UI
 * @param paywall - Optional custom paywall provider (overrides default)
 * @param syncFacilitatorOnStart - Whether to sync with the facilitator on startup (defaults to true)
 * @returns SvelteKit handle
 *
 * @example
 * ```typescript
 * // src/hooks.server.ts
 * import { paymentHandleFromConfig } from "@jamesrisberg/x402-sveltekit";
 *
 * export const handle = paymentHandleFromConfig(routes, facilitatorClient, [
 *   { network: "eip155:84532", server: new ExactEvmScheme() },
 * ]);
 * ```
 */
export function paymentHandleFromConfig(
  routes: RoutesConfig,
  facilitatorClients: FacilitatorClient | FacilitatorClient[],
  schemes?: SchemeRegistration[],
  paywallConfig?: PaywallConfig,
  paywall?: PaywallProvider,
  syncFacilitatorOnStart: boolean = true,
): Handle {
  const resourceServer = new x402ResourceServer(facilitatorClients);

  if (schemes) {
    schemes.forEach(({ network, server: schemeServer }) => {
      resourceServer.register(network, schemeServer);
    });
  }

  return paymentHandle(routes, resourceServer, paywallConfig, paywall, syncFacilitatorOnStart);
}
