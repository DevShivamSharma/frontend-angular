import { GateSide, Stall } from '../models/stall.model';
import { StallObject } from './stall3d-renderer';

/**
 * Wall tagging for the wall-click open-side selection: every wall mesh carries
 * its side in userData, the open side's wall is absent, and floor / markers /
 * the selection outline carry no tag.
 */

function stall(gateSide: GateSide, openSides?: GateSide[]): Stall {
  return {
    id: 'local-1',
    hallId: 9,
    name: 'Shop 1',
    width: 8,
    length: 8,
    height: 4,
    posX: 0,
    posZ: 0,
    color: '#3498db',
    gateSide,
    openSides: openSides ?? [gateSide]
  };
}

function sidesOf(object: StallObject): GateSide[] {
  return object.pickTargets
    .map(target => target.userData['side'] as GateSide | undefined)
    .filter((side): side is GateSide => side !== undefined);
}

describe('StallObject wall side tagging', () => {
  let overlay: HTMLDivElement;
  let objects: StallObject[];

  beforeEach(() => {
    overlay = document.createElement('div');
    objects = [];
  });

  afterEach(() => {
    objects.forEach(object => object.dispose());
    overlay.remove();
  });

  function build(gateSide: GateSide, selected = false): StallObject {
    const object = new StallObject(stall(gateSide), overlay);
    object.update(stall(gateSide), selected);
    objects.push(object);
    return object;
  }

  it('tags each wall mesh with its own side', () => {
    const sides = sidesOf(build('FRONT'));

    expect(sides.sort()).toEqual(['BACK', 'LEFT', 'RIGHT']);
  });

  it('omits the wall on the open side', () => {
    expect(sidesOf(build('BACK'))).not.toContain('BACK');
    expect(sidesOf(build('LEFT'))).not.toContain('LEFT');
    expect(sidesOf(build('RIGHT'))).not.toContain('RIGHT');
  });

  it('leaves floor, markers and the selection outline untagged', () => {
    const object = build('FRONT', true);

    expect(object.pickTargets.length).toBeGreaterThan(sidesOf(object).length);
    expect(
      object.pickTargets.every(
        target =>
          target.userData['side'] === undefined ||
          ['FRONT', 'BACK', 'LEFT', 'RIGHT'].includes(String(target.userData['side']))
      )
    ).toBe(true);
  });

  it('retags after the gate side changes', () => {
    const object = build('FRONT');
    expect(sidesOf(object)).toContain('BACK');

    object.update(stall('BACK'), false);

    expect(sidesOf(object)).toContain('FRONT');
    expect(sidesOf(object)).not.toContain('BACK');
  });

  it('skips the wall on every open side, not just the first', () => {
    const object = new StallObject(stall('FRONT', ['FRONT', 'RIGHT']), overlay);
    object.update(stall('FRONT', ['FRONT', 'RIGHT']), false);
    objects.push(object);

    const sides = sidesOf(object);
    expect(sides).not.toContain('FRONT');
    expect(sides).not.toContain('RIGHT');
    expect(sides.sort()).toEqual(['BACK', 'LEFT']);
  });

  it('renders no walls when all four sides are open', () => {
    const all: GateSide[] = ['FRONT', 'BACK', 'LEFT', 'RIGHT'];
    const object = new StallObject(stall('FRONT', all), overlay);
    object.update(stall('FRONT', all), false);
    objects.push(object);

    expect(sidesOf(object)).toEqual([]);
    // Floor + 4 markers remain as pick targets.
    expect(object.pickTargets.length).toBe(5);
  });

  it('rebuilds when a non-first open side is toggled (gateSide unchanged)', () => {
    const object = new StallObject(stall('FRONT', ['FRONT', 'RIGHT']), overlay);
    object.update(stall('FRONT', ['FRONT', 'RIGHT']), false);
    objects.push(object);
    expect(sidesOf(object)).not.toContain('RIGHT');

    object.update(stall('FRONT'), false);

    expect(sidesOf(object)).toContain('RIGHT');
  });
});
