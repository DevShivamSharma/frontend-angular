import {
  importSelfcareLayout,
  iconUrlFor,
  PX_PER_METRE,
  pixelToPlanner,
  SelfcareLayoutRow,
  toPlanner
} from './selfcare-layout';

/**
 * The real Hall 8-9-10 row (`hall_id` 63) of `t_event_hall_layout_data`, trimmed to the parts
 * each assertion needs. Taken verbatim from the SelfCare export, including the fact that the
 * current rows carry NO red and NO saddlebrown rectangle.
 */
function hall8910(): SelfcareLayoutRow {
  return {
    hall_id: 63,
    length: 133,
    breadth: 43,
    layout_data: {
      shape: 'non-circular',
      stallWidth: 1,
      stallHeight: 1,
      nonClickableAreas: [
        { x: 18, y: 0, width: 54, height: 3, fillColor: '#ffffff', strokeColor: '#ffffff' },
        { x: 59, y: 25, title: 'Pillar', width: 1, height: 1, fillColor: 'gray', strokeColor: 'gray' },
        { x: 1.5, y: 0.5, width: 0.5, height: 37, fillColor: '#742371', strokeColor: '#742371' }
      ]
    },
    helper_text: [
      {
        image: [
          { url: 'assets/images/toilet-male.svg', label: 'Toilet (Male)' },
          { url: 'assets/images/toilet-female.svg', label: 'Toilet (Female)' },
          { url: 'assets/images/stairs.svg', label: 'Stairs/Elevators' }
        ],
        positionX: 2210,
        positionY: 350
      },
      { image: [{ url: 'assets/images/entry-up.svg', label: 'Entry' }], positionX: 1255, positionY: 855 }
    ],
    exit_labels: [
      { text: 'HALL 10', positionX: 720, positionY: 860 },
      { text: 'FOYER C', positionX: 170, positionY: -20 }
    ]
  };
}

describe('importSelfcareLayout', () => {
  it('maps SelfCare length/breadth onto the planner width/length', () => {
    const result = importSelfcareLayout(hall8910());

    expect(result.width).toBe(133);
    expect(result.length).toBe(43);
  });

  it('produces no restriction zones when SelfCare marks none', () => {
    // This is the whole point of the import: the current Hall 8-9-10 plan carries no red
    // "compulsory passage" and no saddlebrown "no construction" rectangle, so the planner must
    // draw none either. Any red band on this hall comes from the rule engine, not from SelfCare.
    expect(importSelfcareLayout(hall8910()).zones).toEqual([]);
  });

  it('reads the red and saddlebrown rectangles as PASSAGE and NO_CONSTRUCTION when present', () => {
    const row = hall8910();
    (row.layout_data as { nonClickableAreas: unknown[] }).nonClickableAreas = [
      { x: 18, y: 25, width: 2, height: 12, fillColor: 'red', strokeColor: 'red' },
      { x: 54.5, y: 3, width: 2.5, height: 1, fillColor: 'saddlebrown', strokeColor: 'saddlebrown' }
    ];

    const zones = importSelfcareLayout(row).zones;

    expect(zones.map(z => z.kind)).toEqual(['PASSAGE', 'NO_CONSTRUCTION']);
    // 18..20 on x, 25..37 on y, in a 133 x 43 hall -> centre-origin -48.5..-46.5 / 3.5..15.5.
    expect(zones[0].polygon).toEqual([
      { x: -48.5, z: 3.5 },
      { x: -46.5, z: 3.5 },
      { x: -46.5, z: 15.5 },
      { x: -48.5, z: 15.5 }
    ]);
  });

  it('classifies the purple outline as wall and the white fill as outside', () => {
    const areas = importSelfcareLayout(hall8910()).blockedAreas;

    expect(areas.map(a => a.kind)).toEqual(['outside', 'zone', 'wall']);
    expect(areas[1].title).toBe('Pillar');
  });

  it('skips rectangles SelfCare flags visibleInView: false', () => {
    const row = hall8910();
    (row.layout_data as { nonClickableAreas: unknown[] }).nonClickableAreas = [
      { x: 1, y: 19.5, width: 84, height: 1, fillColor: '#8a2be2', strokeColor: '#8a2be2', visibleInView: false }
    ];

    const result = importSelfcareLayout(row);

    expect(result.zones).toEqual([]);
    expect(result.blockedAreas).toEqual([]);
  });

  it('turns every helper_text icon into an amenity at its converted position', () => {
    const amenities = importSelfcareLayout(hall8910()).amenities;

    expect(amenities.map(a => a.kind)).toEqual([
      'toilet-male',
      'toilet-female',
      'stairs',
      'entry-up'
    ]);
    expect(amenities[0].label).toBe('Toilet (Male)');
    // 2210 px / 20 = 110.5 m from the left edge -> 110.5 - 66.5 = 44 m, then the cluster spread.
    expect(amenities[1].position).toEqual({ x: 44, z: -4 });
  });

  it('converts exit labels into plan markers', () => {
    const markers = importSelfcareLayout(hall8910()).markers;

    // HALL 10 sits at 720 px / 20 = 36 m across and on the bottom edge (860 px = 43 m).
    expect(markers[0]).toEqual({ text: 'HALL 10', position: { x: -30.5, z: 21.5 } });
    // FOYER C is above the hall, so its Z is outside the outline. That is correct.
    expect(markers[1].position.z).toBe(-22.5);
  });

  it('accepts the JSON columns as raw text, as some clients return them', () => {
    const row = hall8910();
    const asText: SelfcareLayoutRow = {
      ...row,
      layout_data: JSON.stringify(row.layout_data),
      helper_text: JSON.stringify(row.helper_text),
      exit_labels: JSON.stringify(row.exit_labels)
    };

    expect(importSelfcareLayout(asText)).toEqual(importSelfcareLayout(row));
  });

  it('survives null and unparseable JSON columns', () => {
    const result = importSelfcareLayout({ length: 133, breadth: 43, layout_data: 'NULL', helper_text: null });

    expect(result.zones).toEqual([]);
    expect(result.amenities).toEqual([]);
    expect(result.width).toBe(133);
  });
});

describe('coordinate conversion', () => {
  it('turns a top-left rectangle into a centre-origin one', () => {
    const rect = toPlanner({ x: 0, y: 0, width: 10, height: 4 }, 133, 43);

    expect(rect.posX).toBe(-61.5);
    expect(rect.posZ).toBe(-19.5);
    expect(rect.width).toBe(10);
    expect(rect.length).toBe(4);
  });

  it('reads label positions at 20 px per metre', () => {
    expect(PX_PER_METRE).toBe(20);
    // The hall captions sit on breadth * 20 = 860 px, i.e. the bottom edge at +21.5 m.
    expect(pixelToPlanner(2660, 860, 133, 43)).toEqual({ x: 66.5, z: 21.5 });
  });
});

describe('iconUrlFor', () => {
  it('points at the asset SelfCare names in helper_text', () => {
    expect(iconUrlFor('toilet-male')).toBe('assets/images/toilet-male.svg');
  });
});
