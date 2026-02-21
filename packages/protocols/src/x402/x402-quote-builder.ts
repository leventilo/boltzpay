import {
  type AcceptOption,
  type EndpointInputHints,
  parseNetworkIdentifier,
} from "@boltzpay/core";
import { X402QuoteError } from "../adapter-error";
import { usdcAtomicToCents } from "./usdc-conversion";
import type {
  PaymentRequiredAccept,
  PaymentRequiredMetadata,
} from "./x402-parsing";

function buildAllAccepts(
  rawAccepts: readonly PaymentRequiredAccept[],
): AcceptOption[] {
  const result: AcceptOption[] = [];
  for (const raw of rawAccepts) {
    try {
      const parsed = parseNetworkIdentifier(raw.network);
      const atomicAmount = BigInt(raw.amount);
      const cents = usdcAtomicToCents(atomicAmount);
      result.push({
        namespace: parsed.namespace,
        network: raw.network,
        amount: cents,
        payTo: raw.payTo,
        asset: raw.asset,
        scheme: raw.scheme,
      });
    } catch {}
  }
  return result;
}

function resolvePrimaryQuote(
  allAccepts: readonly AcceptOption[],
  rawAccepts: readonly PaymentRequiredAccept[],
): { cents: bigint; network: string; payTo: string } {
  const primaryAccept = allAccepts[0];
  if (primaryAccept) {
    return {
      cents: primaryAccept.amount,
      network: primaryAccept.network,
      payTo: primaryAccept.payTo,
    };
  }

  const rawFirst = rawAccepts[0];
  if (!rawFirst) {
    throw new X402QuoteError("No payment options in x402 response");
  }
  try {
    const atomicAmount = BigInt(rawFirst.amount);
    return {
      cents: usdcAtomicToCents(atomicAmount),
      network: rawFirst.network,
      payTo: rawFirst.payTo,
    };
  } catch {
    throw new X402QuoteError(
      `Invalid amount in payment info: ${rawFirst.amount}`,
    );
  }
}

/** Convert 402 metadata into EndpointInputHints for AI agents. */
function buildInputHints(
  metadata: PaymentRequiredMetadata | undefined,
): EndpointInputHints | undefined {
  if (!metadata) return undefined;

  const hints: EndpointInputHints = {
    method: metadata.bazaarInput?.method,
    queryParams: metadata.bazaarInput?.queryParams,
    bodyFields: metadata.bazaarInput?.bodyFields,
    description: metadata.resource?.description,
    outputExample: metadata.bazaarOutput?.example,
  };

  const hasContent =
    hints.method ?? hints.queryParams ?? hints.bodyFields ?? hints.description;
  return hasContent ? hints : undefined;
}

export { buildAllAccepts, buildInputHints, resolvePrimaryQuote };
