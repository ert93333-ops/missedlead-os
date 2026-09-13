/**
 * 결제 비활성 구현체. PAYMENTS_MODE=disabled일 때 모든 결제 호출을 PaymentsDisabledError로 fail-closed.
 */
import type { StripePayments } from "./app.js";

export class PaymentsDisabledError extends Error {
  constructor() { super("payments_not_enabled"); }
}

export class DisabledPayments implements StripePayments {
  async createCustomerPayment(): Promise<never> { throw new PaymentsDisabledError(); }
  async transfer(): Promise<never> { throw new PaymentsDisabledError(); }
  async refund(): Promise<never> { throw new PaymentsDisabledError(); }
  async reverse(): Promise<never> { throw new PaymentsDisabledError(); }
  async findTransfer(): Promise<never> { throw new PaymentsDisabledError(); }
  async findReversal(): Promise<never> { throw new PaymentsDisabledError(); }
  constructWebhook(): never { throw new PaymentsDisabledError(); }
}
