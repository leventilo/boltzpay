import type { Money } from "@boltzpay/core";
import { BoltzPayError } from "./boltzpay-error";

type PaymentUncertainErrorCode = "payment_uncertain";

export class PaymentUncertainError extends BoltzPayError {
  readonly code: PaymentUncertainErrorCode = "payment_uncertain";
  readonly statusCode = 502;
  readonly url: string;
  readonly amount: Money;
  readonly protocol: string;
  readonly nonce: string | undefined;
  readonly txHash: string | undefined;

  constructor(opts: {
    message: string;
    url: string;
    amount: Money;
    protocol: string;
    nonce?: string;
    txHash?: string;
  }) {
    super(opts.message);
    this.url = opts.url;
    this.amount = opts.amount;
    this.protocol = opts.protocol;
    this.nonce = opts.nonce;
    this.txHash = opts.txHash;
  }
}
