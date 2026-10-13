import type { CheckoutView } from './bookings.models';

/**
 * Razorpay Checkout, loaded from Razorpay's own script on the first payment (no npm package: the
 * script must come from Razorpay). The server's checkout payload carries the public key id; no
 * secret is ever on this side.
 */
const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** The bits of Razorpay's global we use. */
export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', fn: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

/** Loads Checkout.js once, on the first payment; a failed load is tried again next time. */
export function loadCheckout(doc: Document): Promise<RazorpayCtor> {
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const win = doc.defaultView as (Window & { Razorpay?: RazorpayCtor }) | null;
    if (win?.Razorpay) return resolve(win.Razorpay);
    const script = doc.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onload = () => {
      if (win?.Razorpay) return resolve(win.Razorpay);
      loading = null;
      reject(new Error('Razorpay Checkout did not start.'));
    };
    script.onerror = () => {
      loading = null;
      reject(
        new Error('Razorpay Checkout could not be loaded. Check the connection and try again.'),
      );
    };
    doc.head.appendChild(script);
  });
  return loading;
}

export type CheckoutOutcome =
  { kind: 'paid'; response: RazorpayResponse } | { kind: 'closed'; failure: string | null };

/**
 * Opens Checkout and settles when it is done: paid, or closed (with the last failure, if a
 * try failed). A failed try keeps the modal open for another, so failure alone does not settle.
 */
export function openCheckout(
  Razorpay: RazorpayCtor,
  c: CheckoutView,
  color: string,
  method: 'card' | 'netbanking' | null = null,
): Promise<CheckoutOutcome> {
  return new Promise<CheckoutOutcome>((resolve) => {
    let last: string | null = null;
    const rzp = new Razorpay({
      key: c.keyId,
      order_id: c.orderId,
      amount: c.amount,
      currency: c.currency,
      name: c.name,
      description: c.description,
      // Razorpay opens on `method` only when email and contact are prefilled too, as they are.
      prefill: method ? { ...c.prefill, method } : c.prefill,
      theme: { color },
      handler: (response: RazorpayResponse) => resolve({ kind: 'paid', response }),
      modal: { ondismiss: () => resolve({ kind: 'closed', failure: last }) },
    });
    rzp.on('payment.failed', (r) => (last = r.error?.description ?? 'The payment failed.'));
    rzp.open();
  });
}
