import type { BoltzPay, BoltzPayConfig } from "@boltzpay/sdk";

/**
 * Configuration for boltzpayTools(). Accepts either:
 * - A BoltzPayConfig object (SDK creates a new BoltzPay instance)
 * - A pre-built BoltzPay instance (reuse existing SDK)
 */
export type BoltzPayToolsConfig = BoltzPayConfig | BoltzPay;
