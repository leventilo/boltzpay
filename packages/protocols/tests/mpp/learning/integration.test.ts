import { describe, expect, it } from "vitest";
import { Challenge } from "mppx";

// Integration learning tests for mppx with real endpoints.
// Skipped by default -- run manually:
//   cd packages/protocols && pnpm vitest run tests/mpp/learning/integration.test.ts --reporter=verbose
describe("mppx Integration (learning tests)", () => {
  describe.skip("real endpoint probe (@slow)", () => {
    it("Browserbase returns 402 with WWW-Authenticate: Payment header", async () => {
      const response = await fetch("https://api.browserbase.com/v1/sessions", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });

      expect(response.status).toBe(402);

      const wwwAuth = response.headers.get("www-authenticate");
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).not.toBeNull();
      expect(wwwAuth!.toLowerCase()).toContain("payment");
    });

    it("Challenge.fromResponse() succeeds on real Browserbase 402", async () => {
      const response = await fetch("https://api.browserbase.com/v1/sessions", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });

      expect(response.status).toBe(402);

      const challenge = Challenge.fromResponse(response);

      expect(challenge.method).toBeDefined();
      expect(challenge.intent).toBeDefined();
      expect(challenge.realm).toBeDefined();
      expect(challenge.id).toBeDefined();
    });
  });
});
