/**
 * PrimeNG's number input writes `aria-valuenow` as an empty or "null" text while it holds no
 * number, which is not a valid value for that attribute. An empty number input should have none.
 */
export function fixEmptySpinbuttons(doc: Document = document): void {
  const clean = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.getAttribute('role') !== 'spinbutton') return;
    // The input writes it just after the event, so look once that has happened.
    queueMicrotask(() => {
      const now = input.getAttribute('aria-valuenow');
      if (now !== null && (now === '' || Number.isNaN(Number(now)))) {
        input.removeAttribute('aria-valuenow');
      }
    });
    setTimeout(() => {
      const now = input.getAttribute('aria-valuenow');
      if (now !== null && (now === '' || Number.isNaN(Number(now)))) {
        input.removeAttribute('aria-valuenow');
      }
    });
  };
  for (const type of ['focusin', 'input', 'focusout', 'keyup']) {
    doc.addEventListener(type, clean, true);
  }
}
