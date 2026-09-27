import { expect, test } from '@playwright/test';
import { createVenueRenderLoop } from '../src/app/home/venue-render-loop';

function fixture() {
  let nextId = 0;
  let visible = true;
  let moving = false;
  const frames = new Map<number, FrameRequestCallback>();
  let rendered = 0;
  const loop = createVenueRenderLoop(() => {
    loop.invalidate(); // OrbitControls emits change synchronously during update.
    return moving;
  }, () => { rendered++; }, {
    request: callback => { frames.set(++nextId, callback); return nextId; },
    cancel: id => { frames.delete(id); },
    visible: () => visible
  });
  return { loop, frames, get rendered() { return rendered; },
    moving: (value: boolean) => { moving = value; },
    visible: (value: boolean) => { visible = value; },
    frame: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(f => f(0)); }
  };
}

test('home render loop: coalesces input and sleeps without a delayed appearance change', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) f.loop.invalidate();
  expect(f.frames.size).toBe(1);
  f.frame();
  expect(f.rendered).toBe(1);
  expect(f.frames.size).toBe(0);
  f.frame(); f.frame();
  expect(f.rendered).toBe(1);
});

test('home render loop: continues through damping and flight, then wakes on new input', () => {
  const f = fixture();
  f.loop.invalidate(); f.frame();
  f.moving(true); f.loop.invalidate();
  f.frame(); f.frame();
  expect(f.frames.size).toBe(1);
  expect(f.rendered).toBe(3);
  f.moving(false); f.frame();
  expect(f.rendered).toBe(4);
  expect(f.frames.size).toBe(0);
  f.loop.invalidate(); f.frame();
  expect(f.rendered).toBe(5);
});

test('home render loop: hidden tabs pause and resume; disposal cancels all work', () => {
  const f = fixture();
  f.loop.invalidate(); f.frame();
  f.visible(false); f.loop.pause(); f.loop.invalidate(); f.frame();
  expect(f.rendered).toBe(1);
  f.visible(true); f.loop.invalidate(); f.frame();
  expect(f.rendered).toBe(2);
  f.loop.invalidate(); f.loop.dispose(); f.loop.invalidate(); f.frame();
  expect(f.frames.size).toBe(0);
  expect(f.rendered).toBe(2);
});
