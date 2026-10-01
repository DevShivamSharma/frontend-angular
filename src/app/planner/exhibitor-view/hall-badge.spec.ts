import { hallBadge } from './hall-badge';

describe('hallBadge', () => {
  it('splits the hall number from the floor the name gives', () => {
    expect(hallBadge('Hall 14GF')).toEqual({ kicker: 'HALL', code: '14', floor: 'GF · Ground floor' });
    expect(hallBadge('Hall 1FF')).toEqual({ kicker: 'HALL', code: '1', floor: 'FF · First floor' });
  });

  it('shows no floor when the name has none', () => {
    expect(hallBadge('Hall 12A')).toEqual({ kicker: 'HALL', code: '12A', floor: null });
    expect(hallBadge('Hall 8-9-10')).toEqual({ kicker: 'HALL', code: '8-9-10', floor: null });
  });

  it('shows any other name whole', () => {
    expect(hallBadge('Hangar 7A')).toEqual({ kicker: null, code: 'Hangar 7A', floor: null });
  });
});
