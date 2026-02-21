interface PaymentInfo {
  readonly protocol: string;
  readonly amount: string;
  readonly currency: string;
  readonly txHash: string | null;
}

interface RequestMetadata {
  readonly url: string;
  readonly status: number;
  readonly duration: number;
}

export interface CliJsonOutput {
  readonly success: boolean;
  readonly data: unknown;
  readonly payment: PaymentInfo | null;
  readonly metadata: RequestMetadata;
}

export interface CliJsonDeliveryAttempt {
  readonly method: string;
  readonly headerName: string;
  readonly status: number;
  readonly serverMessage?: string;
}

export interface CliJsonDiagnosis {
  readonly phase: string;
  readonly paymentSent: boolean;
  readonly serverStatus?: number;
  readonly serverMessage?: string;
  readonly suggestion?: string;
  readonly deliveryAttempts?: readonly CliJsonDeliveryAttempt[];
}

interface CliJsonError {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly diagnosis?: CliJsonDiagnosis;
  };
}

export function formatJsonOutput(output: CliJsonOutput): string {
  return JSON.stringify(output, null, 2);
}

export function formatJsonError(
  code: string,
  message: string,
  diagnosis?: CliJsonDiagnosis,
): string {
  const error: CliJsonError["error"] = diagnosis
    ? { code, message, diagnosis }
    : { code, message };
  const envelope: CliJsonError = { success: false, error };
  return JSON.stringify(envelope, null, 2);
}
