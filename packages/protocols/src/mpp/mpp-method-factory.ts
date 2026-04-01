import type { Method } from "mppx";
import { tempo, stripe } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { MppPaymentError } from "../adapter-error";

export interface MppWalletConfig {
  readonly tempoPrivateKey?: string;
  readonly stripeSecretKey?: string;
  readonly nwcConnectionString?: string;
  readonly visaJwe?: string;
}

const HEX_PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function validateHexPrivateKey(key: string): `0x${string}` {
  if (!HEX_PRIVATE_KEY_RE.test(key)) {
    throw new MppPaymentError(
      "Invalid private key format. Expected a 0x-prefixed 32-byte hex string (66 characters total).",
    );
  }
  // External key validated above — safe boundary cast
  return key as `0x${string}`;
}

export function createMppMethod(
  walletType: string,
  walletConfig: MppWalletConfig,
): Method.AnyClient {
  switch (walletType) {
    case "tempo":
      return createTempoMethod(walletConfig);
    case "stripe-mpp":
      return createStripeMethod(walletConfig);
    case "nwc":
    case "visa-mpp":
      throw new MppPaymentError(
        `MPP method '${walletType}' not yet supported`,
      );
    default:
      throw new MppPaymentError(
        `Unknown MPP wallet type: ${walletType}`,
      );
  }
}

function createTempoMethod(config: MppWalletConfig): Method.AnyClient {
  if (!config.tempoPrivateKey) {
    throw new MppPaymentError(
      "Tempo wallet requires tempoPrivateKey in config",
    );
  }
  const validatedKey = validateHexPrivateKey(config.tempoPrivateKey);
  const account = privateKeyToAccount(validatedKey);
  return tempo.charge({ account });
}

function createStripeMethod(config: MppWalletConfig): Method.AnyClient {
  if (!config.stripeSecretKey) {
    throw new MppPaymentError(
      "Stripe MPP wallet requires stripeSecretKey in config",
    );
  }
  const secretKey = config.stripeSecretKey;
  return stripe.charge({
    createToken: async ({ amount, currency, networkId, expiresAt, metadata, paymentMethod }) => {
      const response = await globalThis.fetch(
        "https://api.stripe.com/v1/tokens/single_payment",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            amount,
            currency,
            ...(networkId ? { network_id: networkId } : {}),
            expires_at: String(expiresAt),
            ...(paymentMethod ? { payment_method: paymentMethod } : {}),
            ...(metadata
              ? Object.fromEntries(
                  Object.entries(metadata).map(([k, v]) => [
                    `metadata[${k}]`,
                    v,
                  ]),
                )
              : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new MppPaymentError(
          `Stripe SPT creation failed: ${response.status} ${response.statusText}`,
        );
      }
      const data: unknown = await response.json();
      if (
        typeof data !== "object" ||
        data === null ||
        typeof (data as Record<string, unknown>).id !== "string"
      ) {
        throw new MppPaymentError(
          "Stripe SPT response missing required 'id' field",
        );
      }
      // External API response — fields validated above
      return (data as { id: string }).id;
    },
  });
}
