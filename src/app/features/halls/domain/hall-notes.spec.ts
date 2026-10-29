import {
  newHelper,
  newLabel,
  newLegend,
  NO_NOTES,
  notesProblem,
  readNotes,
  sameNotes,
  toNotesFields,
  toNotesPayload,
} from './hall-notes';

const ROW = {
  helper_text: [
    {
      positionX: 200,
      positionY: -40,
      image: [
        { url: 'assets/images/toilet-male.svg', label: 'Gents', width: 30, height: 30 },
        { url: 'assets/images/toilet-female.svg', label: 'Ladies' },
      ],
    },
  ],
  exit_labels: JSON.stringify([{ text: 'Gate 4', positionX: 60, positionY: 100, color: 'red' }]),
  legends: [
    { label: 'Passage', colorCode: '#ffd700', visibleInViewMode: true },
    { label: 'Not for sale', htmlContent: 'NFS', visibleInBookMode: false },
  ],
};

describe('hall notes', () => {
  it('should read ITPO’s pixels as metres, and its text columns as lists', () => {
    const notes = readNotes(ROW);

    expect(notes.helpers[0]).toEqual(
      jasmine.objectContaining({ x: 10, y: -2, kind: 'toilet-male', label: 'Gents' }),
    );
    expect(notes.labels[0]).toEqual(jasmine.objectContaining({ text: 'Gate 4', x: 3, y: 5 }));
    expect(notes.legends.map((l) => [l.label, l.color, l.visible])).toEqual([
      ['Passage', '#ffd700', true],
      ['Not for sale', null, false],
    ]);
  });

  it('should save in ITPO’s pixels, keeping what this portal does not edit', () => {
    const notes = readNotes(ROW);
    notes.helpers[0] = { ...notes.helpers[0], x: 12.5, label: 'Toilets' };
    const fields = toNotesFields(notes);

    expect(fields.helper_text[0]).toEqual(
      jasmine.objectContaining({ positionX: 250, positionY: -40 }),
    );
    const images = fields.helper_text[0]['image'] as Record<string, unknown>[];
    expect(images[0]).toEqual({
      url: 'assets/images/toilet-male.svg',
      label: 'Toilets',
      width: 30,
      height: 30,
    });
    expect(images[1]['label']).toBe('Ladies');
    expect(fields.exit_labels[0]).toEqual({
      text: 'Gate 4',
      positionX: 60,
      positionY: 100,
      color: 'red',
    });
    expect(fields.legends[1]).toEqual(
      jasmine.objectContaining({ htmlContent: 'NFS', visibleInBookMode: false }),
    );
  });

  it('should give a new helper SelfCare’s icon and a 40 px size', () => {
    const fields = toNotesFields({
      helpers: [newHelper('stairs', { x: 1, y: 2 })],
      labels: [],
      legends: [],
    });

    expect(fields.helper_text[0]).toEqual({
      positionX: 20,
      positionY: 40,
      image: [{ width: 40, height: 40, url: 'assets/images/stairs.svg', label: 'Stairs' }],
    });
  });

  it('should say what is missing, and see an unchanged copy as the same', () => {
    const notes = readNotes(ROW);
    expect(notesProblem(notes)).toBeNull();
    expect(sameNotes(notes, readNotes(ROW))).toBe(true);
    expect(notesProblem({ ...notes, labels: [{ ...notes.labels[0], text: ' ' }] })).toBe(
      'Give every text label its words.',
    );
  });
});

describe('the notes of a hall being created', () => {
  it('has no payload when there are no notes, so the hall is made as it always was', () => {
    expect(toNotesPayload(NO_NOTES)).toBeUndefined();
  });

  it('sends each kind only when it has entries, trimmed, in metres', () => {
    const notes = {
      helpers: [{ ...newHelper('stairs', { x: 3, y: -2 }), label: ' Stairs ' }],
      labels: [{ ...newLabel({ x: 1, y: 9.5 }), text: ' Gate A ' }],
      legends: [{ ...newLegend(), label: ' Passage ', color: '#ff0000' }],
    };
    expect(toNotesPayload(notes)).toEqual({
      helpers: [{ kind: 'stairs', label: 'Stairs', x: 3, y: -2 }],
      labels: [{ text: 'Gate A', x: 1, y: 9.5 }],
      legends: [{ label: 'Passage', color: '#ff0000', visible: true }],
    });
    expect(toNotesPayload({ ...NO_NOTES, labels: notes.labels })).toEqual({
      labels: [{ text: 'Gate A', x: 1, y: 9.5 }],
    });
  });

  it('leaves out a legend row that has no colour (a code explained)', () => {
    const code = { label: 'GF: gate', color: null, visible: true, raw: {} };
    expect(toNotesPayload({ ...NO_NOTES, legends: [code] })).toBeUndefined();
  });
});
