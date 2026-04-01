import { Money, type MppMethodQuote, type ProtocolQuote } from "@boltzpay/core";
import { MppQuoteError } from "../adapter-error";
import { usdcAtomicToCents } from "../x402/usdc-conversion";
import type {
  MppMethodSelector,
  MppResolvedMethod,
} from "./mpp-method-selector";
import type { MppChallenge } from "./mpp-types";

function challengeToMethod(challenge: MppChallenge): MppResolvedMethod {
  if (!challenge.request) {
    return {
      method: challenge.method,
      intent: challenge.intent,
      amount: Money.zero(),
      currency: "unknown",
      network: undefined,
      recipient: undefined,
    };
  }

  const rawAmount = BigInt(challenge.request.amount);
  if (rawAmount < 0n) {
    throw new MppQuoteError(
      `Negative amount in MPP challenge: ${challenge.request.amount}`,
    );
  }

  const amount = convertAmount(
    rawAmount,
    challenge.method,
    challenge.request.chainId,
  );

  return {
    method: challenge.method,
    intent: challenge.intent,
    amount,
    currency: challenge.request.currency,
    network: challenge.request.chainId?.toString(),
    recipient: challenge.request.recipient,
  };
}

function convertAmount(
  rawAmount: bigint,
  method: string,
  chainId: number | undefined,
): Money {
  if (method === "stripe") {
    return Money.fromCents(rawAmount);
  }
  if (chainId !== undefined) {
    return Money.fromCents(usdcAtomicToCents(rawAmount));
  }
  if (method === "lightning") {
    return Money.fromSatoshis(rawAmount);
  }
  return Money.fromCents(rawAmount);
}

function toMethodQuote(resolved: MppResolvedMethod): MppMethodQuote {
  return {
    method: resolved.method,
    intent: resolved.intent,
    amount: resolved.amount,
    currency: resolved.currency,
    network: resolved.network,
    recipient: resolved.recipient,
  };
}

export function buildMppQuote(
  challenges: readonly MppChallenge[],
  selector: MppMethodSelector,
): ProtocolQuote {
  const chargeChallenges = challenges.filter((c) => c.intent === "charge");

  if (chargeChallenges.length === 0) {
    throw new MppQuoteError(
      "No charge challenges found in MPP response. Session-based MPP endpoints are not yet supported.",
    );
  }

  const methods = chargeChallenges.map(challengeToMethod);
  const primary = selector.select(methods);
  const allMethods = methods.map(toMethodQuote);

  const hasNoRequest = chargeChallenges.some((c) => !c.request);
  const priceUnknown =
    primary.amount.isZero() && hasNoRequest ? true : undefined;

  return {
    amount: primary.amount,
    protocol: "mpp",
    network: primary.network,
    payTo: primary.recipient,
    scheme: "mpp",
    allMethods: allMethods.length > 1 ? allMethods : undefined,
    selectedMethod: primary.method,
    priceUnknown,
  };
}
