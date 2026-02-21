import { EventEmitter } from "node:events";
import type { BoltzPayEvents, EventListener, EventName } from "./types";

export class TypedEventEmitter {
  private readonly emitter = new EventEmitter();

  on<E extends EventName>(event: E, listener: EventListener<E>): void {
    // Node.js EventEmitter is not generic — cast required to bridge typed listener to untyped emitter.
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<E extends EventName>(event: E, listener: EventListener<E>): void {
    // Node.js EventEmitter is not generic — cast required to bridge typed listener to untyped emitter.
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends EventName>(event: E, ...args: BoltzPayEvents[E]): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
