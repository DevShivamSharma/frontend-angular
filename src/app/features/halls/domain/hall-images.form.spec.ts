import { FormBuilder } from '@angular/forms';

import { chooseCover, createImageGroup, toImagePayloads } from './hall-images.form';

const fb = new FormBuilder();

function group(url: string, cover = false) {
  const g = createImageGroup(fb);
  g.setValue({ url, cover });
  return g;
}

describe('hall images form', () => {
  it('should accept an https address and refuse the rest', () => {
    expect(group('https://static.indiatradefair.com/a.jpg').valid).toBe(true);
    expect(group('http://static.indiatradefair.com/a.jpg').valid).toBe(false);
    expect(group('not a url').valid).toBe(false);
    expect(group('').valid).toBe(false);
  });

  it('should refuse an address longer than ITPO keeps', () => {
    expect(group(`https://x.in/${'a'.repeat(200)}`).valid).toBe(false);
  });

  it('should make one picture the cover and no other', () => {
    const groups = [
      group('https://x.in/a.jpg', true),
      group('https://x.in/b.jpg'),
      group('https://x.in/c.jpg'),
    ];
    groups[1].controls.cover.setValue(true);
    chooseCover(groups, 1);

    expect(groups.map((g) => g.controls.cover.value)).toEqual([false, true, false]);
  });

  it('should turn the cover off when the cover is chosen again', () => {
    const groups = [group('https://x.in/a.jpg', true)];
    groups[0].controls.cover.setValue(false);
    chooseCover(groups, 0);

    expect(groups[0].controls.cover.value).toBe(false);
  });

  it('should send the pictures filled in, trimmed, and skip an empty row', () => {
    const payload = toImagePayloads([
      group(' https://x.in/a.jpg ', true),
      group(''),
      group('https://x.in/b.jpg'),
    ]);

    expect(payload).toEqual([
      { url: 'https://x.in/a.jpg', kind: 'cover' },
      { url: 'https://x.in/b.jpg', kind: 'gallery' },
    ]);
  });
});
