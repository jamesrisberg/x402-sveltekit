import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import type { HTTPProcessResult, x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  paymentHandle,
  paymentHandleFromConfig,
  setSettlementOverrides,
  type SchemeRegistration,
} from "./index";

// --- Test Fixtures ---
const mockRoutes = {
  "/api/*": {
    accepts: { scheme: "exact", payTo: "0x123", price: "$0.01", network: "eip155:84532" },
  },
} as const;

const mockPaymentPayload = {
  scheme: "exact",
  network: "eip155:84532",
  payload: { signature: "0xabc" },
} as unknown as PaymentPayload;

const mockPaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  maxAmountRequired: "1000",
  payTo: "0x123",
} as unknown as PaymentRequirements;

// --- Mock setup ---
let mockProcessHTTPRequest: ReturnType<typeof vi.fn>;
let mockProcessSettlement: ReturnType<typeof vi.fn>;
let mockRegisterPaywallProvider: ReturnType<typeof vi.fn>;
let mockRequiresPayment: ReturnType<typeof vi.fn>;
let mockRegister: ReturnType<typeof vi.fn>;

type PaymentVerifiedResult = Extract<HTTPProcessResult, { type: "payment-verified" }>;
type MockHTTPProcessResult =
  | Exclude<HTTPProcessResult, PaymentVerifiedResult>
  | (Omit<PaymentVerifiedResult, "cancellationDispatcher"> & {
      cancellationDispatcher?: PaymentVerifiedResult["cancellationDispatcher"];
    });

/**
 * Creates a mock payment cancellation dispatcher.
 *
 * @returns Mock payment cancellation dispatcher.
 */
function createMockPaymentCancellationDispatcher(): PaymentVerifiedResult["cancellationDispatcher"] {
  return {
    cancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaymentVerifiedResult["cancellationDispatcher"];
}

vi.mock("@x402/core/server", () => ({
  SETTLEMENT_OVERRIDES_HEADER: "Settlement-Overrides",
  FacilitatorResponseError: class FacilitatorResponseError extends Error {
    /**
     * Creates a mock facilitator response error.
     *
     * @param message - Error message.
     */
    constructor(message: string) {
      super(message);
      this.name = "FacilitatorResponseError";
    }
  },
  RouteConfigurationError: class RouteConfigurationError extends Error {},
  getFacilitatorResponseError: (error: unknown) => {
    let current = error;
    while (current instanceof Error) {
      if (current.name === "FacilitatorResponseError") {
        return current;
      }
      current = (current as Error & { cause?: unknown }).cause;
    }
    return null;
  },
  x402ResourceServer: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    registerExtension: vi.fn(),
    register: mockRegister,
    hasExtension: vi.fn().mockReturnValue(false),
  })),
  x402HTTPResourceServer: vi.fn().mockImplementation((server, routes) => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    processHTTPRequest: mockProcessHTTPRequest,
    processSettlement: mockProcessSettlement,
    registerPaywallProvider: mockRegisterPaywallProvider,
    requiresPayment: mockRequiresPayment,
    routes: routes,
    server: server || {
      hasExtension: vi.fn().mockReturnValue(false),
      registerExtension: vi.fn(),
    },
  })),
  checkIfBazaarNeeded: vi.fn().mockReturnValue(false),
}));

/**
 * Sets up the mock HTTP server to return specified results.
 *
 * @param processResult - The result to return from processHTTPRequest.
 * @param settlementResult - Result to return from processSettlement.
 */
function setupMockHttpServer(
  processResult: MockHTTPProcessResult,
  settlementResult:
    | { success: true; headers: Record<string, string> }
    | {
        success: false;
        errorReason: string;
        headers: Record<string, string>;
        response: { status: number; headers: Record<string, string>; body?: unknown };
      } = {
    success: true,
    headers: {},
  },
): void {
  const normalizedResult =
    processResult.type === "payment-verified"
      ? {
          ...processResult,
          cancellationDispatcher:
            processResult.cancellationDispatcher ?? createMockPaymentCancellationDispatcher(),
        }
      : processResult;
  mockProcessHTTPRequest.mockResolvedValue(normalizedResult);
  mockProcessSettlement.mockResolvedValue(settlementResult);
}

/**
 * Creates a mock SvelteKit RequestEvent for testing.
 *
 * @param options - Configuration options for the mock event.
 * @param options.path - The request URL path.
 * @param options.method - The HTTP method.
 * @param options.headers - Request headers.
 * @returns A mock RequestEvent.
 */
function createEvent(
  options: { path?: string; method?: string; headers?: Record<string, string> } = {},
): RequestEvent {
  const url = `https://example.com${options.path || "/api/test"}`;
  return {
    request: new Request(url, { method: options.method || "GET", headers: options.headers }),
    url: new URL(url),
  } as RequestEvent;
}

/**
 * Creates a resolve function returning the given response.
 *
 * @param response - The response the route handler produces.
 * @returns A mock resolve function.
 */
function createResolve(response: Response = new Response("ok", { status: 200 })) {
  return vi.fn().mockResolvedValue(response);
}

/**
 * Creates a mock x402ResourceServer instance.
 *
 * @returns A mock resource server.
 */
function createMockServer(): x402ResourceServer {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    register: mockRegister,
    registerExtension: vi.fn(),
    hasExtension: vi.fn().mockReturnValue(false),
  } as unknown as x402ResourceServer;
}

beforeEach(() => {
  mockProcessHTTPRequest = vi.fn();
  mockProcessSettlement = vi.fn();
  mockRegisterPaywallProvider = vi.fn();
  mockRequiresPayment = vi.fn().mockReturnValue(true);
  mockRegister = vi.fn();
});

describe("paymentHandle", () => {
  it("passes through when the route does not require payment", async () => {
    mockRequiresPayment.mockReturnValue(false);
    const handle = paymentHandle(mockRoutes, createMockServer());
    const resolve = createResolve();

    const response = await handle({ event: createEvent(), resolve });

    expect(resolve).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(mockProcessHTTPRequest).not.toHaveBeenCalled();
  });

  it("passes through on a no-payment-required result", async () => {
    setupMockHttpServer({ type: "no-payment-required" });
    const handle = paymentHandle(mockRoutes, createMockServer());
    const resolve = createResolve();

    const response = await handle({ event: createEvent(), resolve });

    expect(resolve).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("returns a 402 JSON response with payment requirement headers", async () => {
    setupMockHttpServer({
      type: "payment-error",
      response: {
        status: 402,
        headers: { "PAYMENT-REQUIRED": "encoded", "Content-Type": "application/json" },
        body: { error: "Payment required" },
      },
    });
    const handle = paymentHandle(mockRoutes, createMockServer());
    const resolve = createResolve();

    const response = await handle({ event: createEvent(), resolve });

    expect(resolve).not.toHaveBeenCalled();
    expect(response.status).toBe(402);
    expect(response.headers.get("PAYMENT-REQUIRED")).toBe("encoded");
    expect(await response.json()).toEqual({ error: "Payment required" });
  });

  it("returns an HTML paywall response for browser requests", async () => {
    setupMockHttpServer({
      type: "payment-error",
      response: {
        status: 402,
        headers: { "Content-Type": "text/html" },
        body: "<html>paywall</html>",
        isHtml: true,
      },
    });
    const handle = paymentHandle(mockRoutes, createMockServer());

    const response = await handle({ event: createEvent(), resolve: createResolve() });

    expect(response.status).toBe(402);
    expect(await response.text()).toBe("<html>paywall</html>");
  });

  it("settles payment and adds settlement headers on success", async () => {
    setupMockHttpServer(
      {
        type: "payment-verified",
        paymentPayload: mockPaymentPayload,
        paymentRequirements: mockPaymentRequirements,
      },
      { success: true, headers: { "PAYMENT-RESPONSE": "receipt" } },
    );
    const handle = paymentHandle(mockRoutes, createMockServer());
    const resolve = createResolve(
      new Response(JSON.stringify({ data: "premium" }), { status: 200 }),
    );

    const response = await handle({ event: createEvent(), resolve });

    expect(mockProcessSettlement).toHaveBeenCalledWith(
      mockPaymentPayload,
      mockPaymentRequirements,
      undefined,
      expect.objectContaining({ responseBody: expect.anything() }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("PAYMENT-RESPONSE")).toBe("receipt");
    expect(await response.json()).toEqual({ data: "premium" });
  });

  it("strips the settlement overrides header from the client response", async () => {
    setupMockHttpServer(
      {
        type: "payment-verified",
        paymentPayload: mockPaymentPayload,
        paymentRequirements: mockPaymentRequirements,
      },
      { success: true, headers: {} },
    );
    const handle = paymentHandle(mockRoutes, createMockServer());
    const handlerResponse = new Response("ok", { status: 200 });
    setSettlementOverrides(handlerResponse, { amount: "500" });

    const response = await handle({
      event: createEvent(),
      resolve: createResolve(handlerResponse),
    });

    expect(response.headers.get("Settlement-Overrides")).toBeNull();
  });

  it("does not settle and cancels payment when the handler returns an error status", async () => {
    const cancellationDispatcher = createMockPaymentCancellationDispatcher();
    setupMockHttpServer({
      type: "payment-verified",
      paymentPayload: mockPaymentPayload,
      paymentRequirements: mockPaymentRequirements,
      cancellationDispatcher,
    });
    const handle = paymentHandle(mockRoutes, createMockServer());

    const response = await handle({
      event: createEvent(),
      resolve: createResolve(new Response("boom", { status: 500 })),
    });

    expect(mockProcessSettlement).not.toHaveBeenCalled();
    expect(cancellationDispatcher.cancel).toHaveBeenCalledWith({
      reason: "handler_failed",
      responseStatus: 500,
    });
    expect(response.status).toBe(500);
  });

  it("cancels payment and rethrows when the handler throws", async () => {
    const cancellationDispatcher = createMockPaymentCancellationDispatcher();
    setupMockHttpServer({
      type: "payment-verified",
      paymentPayload: mockPaymentPayload,
      paymentRequirements: mockPaymentRequirements,
      cancellationDispatcher,
    });
    const handle = paymentHandle(mockRoutes, createMockServer());
    const error = new Error("handler exploded");
    const resolve = vi.fn().mockRejectedValue(error);

    await expect(handle({ event: createEvent(), resolve })).rejects.toThrow("handler exploded");
    expect(cancellationDispatcher.cancel).toHaveBeenCalledWith({
      reason: "handler_threw",
      error,
    });
    expect(mockProcessSettlement).not.toHaveBeenCalled();
  });

  it("withholds the resource when settlement fails", async () => {
    setupMockHttpServer(
      {
        type: "payment-verified",
        paymentPayload: mockPaymentPayload,
        paymentRequirements: mockPaymentRequirements,
      },
      {
        success: false,
        errorReason: "insufficient_funds",
        headers: {},
        response: {
          status: 402,
          headers: { "Content-Type": "application/json" },
          body: { error: "settlement failed" },
        },
      },
    );
    const handle = paymentHandle(mockRoutes, createMockServer());

    const response = await handle({
      event: createEvent(),
      resolve: createResolve(new Response("premium", { status: 200 })),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "settlement failed" });
  });

  it("returns a 502 when the facilitator errors during payment processing", async () => {
    const { FacilitatorResponseError } = await import("@x402/core/server");
    mockProcessHTTPRequest.mockRejectedValue(new FacilitatorResponseError("facilitator down"));
    const handle = paymentHandle(mockRoutes, createMockServer());

    const response = await handle({ event: createEvent(), resolve: createResolve() });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "facilitator down" });
  });

  it("registers a custom paywall provider when provided", async () => {
    setupMockHttpServer({ type: "no-payment-required" });
    const paywall = { generateHtml: vi.fn() };
    paymentHandle(mockRoutes, createMockServer(), undefined, paywall);

    expect(mockRegisterPaywallProvider).toHaveBeenCalledWith(paywall);
  });
});

describe("paymentHandleFromConfig", () => {
  it("registers provided schemes on the resource server", async () => {
    setupMockHttpServer({ type: "no-payment-required" });
    const schemes: SchemeRegistration[] = [
      { network: "eip155:84532", server: { scheme: "exact" } as SchemeRegistration["server"] },
    ];

    const handle = paymentHandleFromConfig(mockRoutes, [], schemes);
    await handle({ event: createEvent(), resolve: createResolve() });

    expect(mockRegister).toHaveBeenCalledWith("eip155:84532", schemes[0].server);
  });
});

describe("setSettlementOverrides", () => {
  it("sets the settlement overrides header as JSON", () => {
    const response = new Response("ok");
    setSettlementOverrides(response, { amount: "500" });

    expect(response.headers.get("Settlement-Overrides")).toBe(JSON.stringify({ amount: "500" }));
  });
});
