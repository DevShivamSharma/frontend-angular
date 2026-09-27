interface FrameClock {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  visible: () => boolean;
}

const browserClock: FrameClock = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
  visible: () => !document.hidden
};

/** Render input and camera motion promptly, then release the GPU without changing the image.
 * update returns true while camera damping or a destination flight still needs frames.
 */
export function createVenueRenderLoop(
  update: () => boolean,
  render: () => void,
  clock: FrameClock = browserClock
) {
  let frame: number | null = null;
  let updating = false;
  let disposed = false;

  function invalidate() {
    if (disposed) return;
    // OrbitControls emits change from inside update; do not queue a duplicate frame.
    if (!updating && frame === null && clock.visible()) frame = clock.request(tick);
  }

  function tick() {
    frame = null;
    if (disposed || !clock.visible()) return;
    updating = true;
    let moving: boolean;
    try { moving = update(); } finally { updating = false; }
    render();
    if (moving) invalidate();
  }

  function pause() {
    if (frame !== null) clock.cancel(frame);
    frame = null;
  }

  return { invalidate, pause, dispose() { disposed = true; pause(); } };
}
