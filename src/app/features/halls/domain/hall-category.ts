/** SelfCare's own test for the Non-Tower Area category, by its name. */
export function isNtaCategory(name: string | null | undefined): boolean {
  const plain = (name ?? '').toLowerCase().replace(/\./g, '').trim();
  return plain.includes('non-tower') || plain === 'nta';
}
