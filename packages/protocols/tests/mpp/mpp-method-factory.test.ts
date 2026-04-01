import { describe, expect, it, vi } from "vitest";
import { MppPaymentError } from "../../src/adapter-error";

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn((key: string) => ({
    address: "0xMockAddress",
    source: "privateKey",
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signTypedData: vi.fn(),
    _key: key,
  })),
}));

describe("createMppMethod", () => {
  it("returns a method with name 'tempo' for tempo wallet type", async () => {
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    const method = await createMppMethod("tempo", {
      tempoPrivateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(method.name).toBe("tempo");
    expect(method.intent).toBe("charge");
  });

  it("returns a method with name 'stripe' for stripe-mpp wallet type", async () => {
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    const method = await createMppMethod("stripe-mpp", {
      stripeSecretKey: "sk_test_abc123",
    });
    expect(method.name).toBe("stripe");
    expect(method.intent).toBe("charge");
  });

  it("throws MppPaymentError for nwc wallet type", async () => {
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    let error: unknown;
    try {
      await createMppMethod("nwc", {
        nwcConnectionString: "nostr+walletconnect://test",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MppPaymentError);
    expect((error as MppPaymentError).message).toContain("not yet supported");
  });

  it("throws MppPaymentError for visa-mpp wallet type", async () => {
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    let error: unknown;
    try {
      await createMppMethod("visa-mpp", { visaJwe: "jwe_token" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MppPaymentError);
    expect((error as MppPaymentError).message).toContain("not yet supported");
  });

  it("throws MppPaymentError for unknown wallet type", async () => {
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    let error: unknown;
    try {
      await createMppMethod("unknown-wallet", {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MppPaymentError);
    expect((error as MppPaymentError).message).toContain(
      "Unknown MPP wallet type",
    );
  });

  it("passes privateKeyToAccount the tempo private key cast as hex", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const { createMppMethod } = await import(
      "../../src/mpp/mpp-method-factory"
    );
    const key =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await createMppMethod("tempo", { tempoPrivateKey: key });
    expect(privateKeyToAccount).toHaveBeenCalledWith(key);
  });
});
