import type { PaymentDetails } from "../history/types";

interface BoltzPayResponseInit {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly rawBody: Uint8Array;
  readonly payment?: PaymentDetails;
  readonly protocol?: string;
}

/**
 * Response wrapper returned by `BoltzPay.fetch()`. Mirrors the standard `Response` API
 * with additional `payment` and `protocol` metadata when a payment was made.
 */
export class BoltzPayResponse {
  /** True if the HTTP status is 2xx. */
  readonly ok: boolean;
  /** HTTP status code of the final response. */
  readonly status: number;
  /** Response headers as a plain object. */
  readonly headers: Record<string, string>;
  /** Payment metadata if a payment was made, undefined for free endpoints. */
  readonly payment: PaymentDetails | undefined;
  /** Protocol used for payment (e.g. "x402", "l402"), undefined if no payment. */
  readonly protocol: string | undefined;
  private readonly rawBody: Uint8Array;

  constructor(init: BoltzPayResponseInit) {
    this.ok = init.ok;
    this.status = init.status;
    this.headers = init.headers;
    this.rawBody = init.rawBody;
    this.payment = init.payment;
    this.protocol = init.protocol;
  }

  /** Parse the response body as JSON. Caller is responsible for type safety. */
  async json<T = unknown>(): Promise<T> {
    const text = new TextDecoder().decode(this.rawBody);
    return JSON.parse(text) as T;
  }

  /** Read the response body as a UTF-8 string. */
  async text(): Promise<string> {
    return new TextDecoder().decode(this.rawBody);
  }

  /** Read the response body as an ArrayBuffer. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    const copy = new ArrayBuffer(this.rawBody.byteLength);
    new Uint8Array(copy).set(this.rawBody);
    return copy;
  }

  /** Read the response body as a Blob. */
  async blob(): Promise<Blob> {
    const buffer = await this.arrayBuffer();
    return new Blob([buffer]);
  }

  /** Readable stream of the response body. Returns null for empty bodies (matches Web Response contract). */
  get body(): ReadableStream<Uint8Array> | null {
    if (this.rawBody.length === 0) {
      return null;
    }

    const data = this.rawBody;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  /** Create a BoltzPayResponse from a standard fetch Response. */
  static async fromFetch(
    response: Response,
    payment?: PaymentDetails,
  ): Promise<BoltzPayResponse> {
    const buffer = await response.arrayBuffer();
    const rawBody = new Uint8Array(buffer);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return new BoltzPayResponse({
      ok: response.ok,
      status: response.status,
      headers,
      rawBody,
      payment,
      protocol: payment?.protocol,
    });
  }
}
