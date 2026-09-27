import { VenueLoadingState } from './venue-loading.state';

describe('VenueLoadingState', () => {
  it('keeps the source 80/10/10 weighting and waits for all three sources', async () => {
    const state = new VenueLoadingState();
    state.progress('venue', .5);
    expect(state.percent()).toBe(40);
    await state.run('rooms', async () => {});
    await state.run('halls', async () => {});
    expect(state.percent()).toBe(60);
    expect(state.ready()).toBeFalse();
    await state.run('venue', async () => {});
    expect(state.percent()).toBe(100);
    expect(state.ready()).toBeTrue();
  });
  it('coalesces in-flight tasks and retries only a failed source', async () => {
    const state = new VenueLoadingState();
    let attempts = 0;
    const task = jasmine.createSpy('load rooms').and.callFake(async () => { if (++attempts === 1) throw new Error('offline'); });
    const first = state.run('rooms', task);
    expect(state.run('rooms', task)).toBe(first);
    await first;
    expect(state.failed()).toBeTrue();
    expect(task).toHaveBeenCalledTimes(1);
    await state.retry();
    expect(state.stages().rooms.state).toBe('ready');
    expect(task).toHaveBeenCalledTimes(2);
    await state.run('rooms', task);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('does not mutate state after a route exit while a source finishes', async () => {
    const state = new VenueLoadingState();
    let resolve!: () => void;
    const pending = state.run('venue', () => new Promise<void>(done => resolve = done));
    await Promise.resolve();
    state.destroy();resolve();await pending;
    expect(state.stages().venue.state).toBe('loading');
    state.progress('venue', 1);
    expect(state.percent()).toBe(0);
  });
});
