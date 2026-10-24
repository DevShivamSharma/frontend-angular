import { buildHallPayload, HallDetails } from './hall-payload';

const DETAILS: HallDetails = {
  name: '  Hall 20 ',
  hallCategoryId: null,
  hallAreaCapacity: null,
  isPopular: false,
  isVipLounge: false,
  isAvailableForFnB: false,
  complimentaryDays: 0,
  sortOrder: null,
};

const RECT: [number, number][] = [
  [0, 0],
  [40, 0],
  [40, 30],
  [0, 30],
];
const L: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 3],
  [10, 3],
  [10, 8],
  [0, 8],
];

describe('buildHallPayload', () => {
  it('should send only the name and size for a plain rectangle', () => {
    expect(buildHallPayload(DETAILS, RECT, false)).toEqual({
      name: 'Hall 20',
      width: 40,
      depth: 30,
    });
  });

  it('should send the outline when the hall is not a rectangle, with its box as the size', () => {
    const payload = buildHallPayload(DETAILS, L, false);

    expect(payload).toEqual(jasmine.objectContaining({ width: 10, depth: 8 }));
    expect(payload.outline).toEqual(L);
  });

  it('should send the optional details only when they were given', () => {
    const payload = buildHallPayload(
      {
        ...DETAILS,
        hallCategoryId: 1,
        hallAreaCapacity: 1100,
        isPopular: true,
        isVipLounge: true,
        isAvailableForFnB: true,
        complimentaryDays: 1,
        sortOrder: 3,
      },
      RECT,
      false,
    );

    expect(payload).toEqual(
      jasmine.objectContaining({
        hallCategoryId: 1,
        hallAreaCapacity: 1100,
        isPopular: true,
        isVipLounge: true,
        isAvailableForFnB: true,
        complementaryDays: 1,
        sortOrder: 3,
      }),
    );
  });

  it('should leave out the VIP lounge, F&B, complementary days and order for an NTA hall', () => {
    const payload = buildHallPayload(
      {
        ...DETAILS,
        hallCategoryId: 4,
        isPopular: true,
        isVipLounge: true,
        isAvailableForFnB: true,
        complimentaryDays: 1,
        sortOrder: 3,
      },
      RECT,
      true,
    );

    expect(payload).toEqual({
      name: 'Hall 20',
      width: 40,
      depth: 30,
      hallCategoryId: 4,
      isPopular: true,
    });
  });

  it('should not send a capacity of nothing, but a capacity of zero', () => {
    expect(
      buildHallPayload({ ...DETAILS, hallAreaCapacity: 0 }, RECT, false).hallAreaCapacity,
    ).toBe(0);
    expect('hallAreaCapacity' in buildHallPayload(DETAILS, RECT, false)).toBe(false);
  });
});
