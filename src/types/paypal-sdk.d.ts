/**
 * Minimal ambient declaration for @paypal/checkout-server-sdk (plain JS SDK).
 *
 * The SDK surface used by Phase 10 is deliberately narrow: the HTTP core and
 * the webhook verification request. Type-safe projects avoid importing the
 * SDK statically; the route loads it lazily and this module keeps only the
 * shape the verified-settlement path needs.
 */

declare module '@paypal/checkout-server-sdk' {
  export const core: {
    PayPalHttpClient: new (environment: unknown) => { execute<T>(request: unknown): Promise<{ result: T }> };
    SandboxEnvironment: new (clientId: string, clientSecret: string) => unknown;
    LiveEnvironment: new (clientId: string, clientSecret: string) => unknown;
  };
  export const webhooks: {
    VerifyWebhookSignatureRequest: new () => {
      requestBody(body: Record<string, unknown>): void;
    };
  };
  export const orders: {
    OrdersCreateRequest: new () => {
      prefer(value: string): void;
      requestBody(body: Record<string, unknown>): void;
    };
    OrdersCaptureRequest: new (orderId: string) => {
      requestBody(body?: Record<string, unknown>): void;
    };
  };
}
