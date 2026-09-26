import {
  importSelfcareEventHalls,
  importSelfcareLayout,
  importSelfcareResponse,
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

/**
 * The live SelfCare API responses, verbatim apart from a trimmed `nonClickableAreas` list.
 *
 * These differ from the database export in three ways that broke the first importer: the hall id
 * is `hallId` not `hall_id`, the hall has a `name`, and everything is wrapped in a
 * `{ header, data }` envelope with the single hall inside a one-element array.
 */
function hallLayoutResponse() {
  return {
    header: { code: 200, error: false, success: true, msg: 'Success' },
    data: [
      {
        hallId: 63,
        name: 'Hall 8-9-10',
        length: 133,
        breadth: 43,
        layout_data: {
          shape: 'non-circular',
          stallWidth: 1,
          stallHeight: 1,
          nonClickableAreas: [
            { x: 18, y: 0, width: 54, height: 3, fillColor: '#ffffff', strokeColor: '#ffffff' },
            { x: 1.5, y: 0.5, width: 0.5, height: 37, fillColor: '#742371', strokeColor: '#742371' }
          ]
        },
        legends: [
          { label: 'Compulsory passage for entry/exit/services', colorCode: 'red' },
          { label: 'NC - No Construction Zone', colorCode: 'saddlebrown' },
          {
            label: 'Entry or exit gates',
            htmlContent: '<p class="color-dark fw-500 mb-0">E:</p>',
            visibleInBookMode: false
          }
        ],
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
        exit_labels: [{ text: 'HALL 10', positionX: 720, positionY: 860 }],
        direction: {
          image: { url: 'assets/images/direction.svg', width: 100, height: 100, rotation: -90, positionX: 10, positionY: 10 },
          label: { text: 'N', positionX: -28, positionY: -35 },
          positionX: 2600,
          positionY: 950
        },
        default_stalls: null
      }
    ]
  };
}

function eventResponse() {
  return {
    header: { code: 200, error: false, success: true, msg: 'Success' },
    data: {
      id: '60fb0781-5145-450d-9a24-a71eb2174ef1',
      eventName: 'Shivam Tesing',
      halls: [
        { hallId: 78, hallName: 'Convention Center', stallCount: 0, eventLayoutId: null },
        { hallId: 63, hallName: 'Hall 8-9-10', stallCount: 0, eventLayoutId: 103 },
        { hallId: 64, hallName: 'Hall 11', stallCount: 0, eventLayoutId: null }
      ]
    }
  };
}

describe('live SelfCare API payloads', () => {
  it('unwraps the { header, data: [row] } envelope', () => {
    const halls = importSelfcareResponse(hallLayoutResponse());

    expect(halls.length).toBe(1);
    expect(halls[0].id).toBe(63);
    expect(halls[0].name).toBe('Hall 8-9-10');
    expect(halls[0].width).toBe(133);
    expect(halls[0].length).toBe(43);
  });

  it('reads hallId, the API spelling, as well as the export hall_id', () => {
    expect(importSelfcareLayout({ hallId: 63 }).hallId).toBe(63);
    expect(importSelfcareLayout({ hall_id: 63 }).hallId).toBe(63);
    expect(importSelfcareLayout({}).hallId).toBeNull();
  });

  it('still marks no passage for the live Hall 8-9-10 payload', () => {
    // The live response carries the same white/purple-only rectangles as the export: the plan
    // genuinely has no compulsory-passage or no-construction zone.
    expect(importSelfcareResponse(hallLayoutResponse())[0].zones).toEqual([]);
  });

  it('imports the north arrow from `direction`', () => {
    const compass = importSelfcareResponse(hallLayoutResponse())[0].compass!;

    // 2600 px / 20 = 130 m across, 950 px / 20 = 47.5 m down -> outside a 133 x 43 m hall.
    expect(compass.position).toEqual({ x: 63.5, z: 26 });
    expect(compass.size).toBe(5); // 100 px / 20
    expect(compass.rotation).toBe(-90);
    expect(compass.label).toBe('N');
    expect(compass.labelOffset).toEqual({ x: -1.4, z: -1.75 });
  });

  it('carries the legend rows, colour swatches and markup notes alike', () => {
    const legends = importSelfcareResponse(hallLayoutResponse())[0].legends!;

    expect(legends.length).toBe(3);
    expect(legends[0]).toEqual({ label: 'Compulsory passage for entry/exit/services', colorCode: 'red' });
    expect(legends[2].htmlContent).toContain('E:');
    expect(legends[2].visibleInBookMode).toBe(false);
  });

  it('has no compass or legends when the row omits them', () => {
    const hall = importSelfcareLayout({ length: 133, breadth: 43 });

    expect(hall.compass).toBeNull();
    expect(hall.legends).toEqual([]);
  });
});

describe('importSelfcareEventHalls', () => {
  it('lists the event halls and flags which ones have a published layout', () => {
    const halls = importSelfcareEventHalls(eventResponse());

    expect(halls.map(h => h.name)).toEqual(['Convention Center', 'Hall 8-9-10', 'Hall 11']);
    expect(halls.find(h => h.id === 63)).toEqual({
      id: 63,
      name: 'Hall 8-9-10',
      hasLayout: true,
      eventLayoutId: 103,
      stallCount: 0
    });
    // Only Hall 8-9-10 has a layout to fetch in this event.
    expect(halls.filter(h => h.hasLayout).length).toBe(1);
  });

  it('falls back to a generated name and tolerates a missing halls array', () => {
    expect(importSelfcareEventHalls({ data: { halls: [{ hallId: 9 }] } })[0].name).toBe('Hall 9');
    expect(importSelfcareEventHalls({ data: {} })).toEqual([]);
  });
});
