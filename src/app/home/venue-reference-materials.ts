import * as T from 'three';

export interface ReferenceFinish { color: string; roughness: number; metalness: number; }

// Visual colour estimates, not sampled/surveyed colour specifications. The same
// seven authored panel identities retain their existing widths and positions.
// 0014 00:00–00:32 (H1/H2), 0017 00:06–00:12 (H6), 0009 00:08–00:31 (H14).
const CLADDING = ['#bd7762', '#aa5549', '#d7cbb3', '#cfaa8d', '#67777c', '#923f38', '#b56a53'];
const EVIDENCE = ['DJI_20250217154115_0014_D.MP4 00:00–00:32',
  'DJI_20250217154441_0017_D.MP4 00:06–00:12'];

/** Correct the visible material families without moving inferred plan geometry.
 * Unseen elevations and H3–5 use the existing model's shared panel system; their
 * individual panel sequence is not claimed to have been verified by the footage.
 */
export function prepareReferenceMaterials(root: T.Group): void {
  if (root.userData['referenceMaterialsPrepared']) return;
  root.userData['referenceMaterialsPrepared'] = true;
  const variants = new Map<T.Material, T.MeshStandardMaterial>();
  const unused = new Set<T.Material>();
  const coverage: Record<string, number> = {};
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let names = '', id: string | undefined, gate6 = false;
    for (let n: T.Object3D | null = object; n && n !== root; n = n.parent) {
      names += ' ' + n.name;
      id ??= n.userData['hall'] ? String(n.userData['hall']) : undefined;
      gate6 ||= n.userData['gate_id'] === 'gate6';
    }
    id ??= /HALL[_ ](14|[1-6])(?:[_ ]|$)/.exec(names)?.[1];
    if ((!gate6 && (!id || !['1', '2', '3', '4', '5', '6', '14'].includes(id))) ||
        /label|sign|lettering|floor[ _]plan|interior/i.test(names)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const next = materials.map(material => {
      if (!(material instanceof T.MeshStandardMaterial) || material.userData['referenceMaterial']) return material;
      const panel = /^PM_Cladding (\d)$/.exec(material.name);
      const finish: ReferenceFinish | undefined = panel ?
        { color: CLADDING[Number(panel[1])], roughness: .69, metalness: .08 } :
        /Ivory aluminium fascia/.test(material.name) ? { color: '#d7ceba', roughness: .65, metalness: .12 } :
        /Deep green low E glass|deep curtain glass/.test(material.name) ? { color: '#476374', roughness: .23, metalness: .28 } :
        /Agra sandstone/.test(material.name) ? { color: '#b26d56', roughness: .88, metalness: .02 } :
        gate6 && /red sandstone course|sandstone deep joint/.test(material.name) ?
          { color: /deep joint/.test(material.name) ? '#75473d' : ['#b16c59','#ae6655','#bb7965','#b77260','#ad6556','#c0836e'][Number(/course (\d)/.exec(material.name)?.[1] ?? 2)], roughness: .9, metalness: .01 } : undefined;
      if (!finish) return material;
      let variant = variants.get(material);
      if (!variant) {
        variant = material.clone(); variant.name = 'REFERENCE_' + material.name;
        variant.userData = { ...material.userData, referenceMaterial: true, referenceFinish: finish,
          referenceEvidence: gate6 ? ['DJI_20250217163917_0040_D.MP4 00:33; numbered sandstone portal'] : EVIDENCE,
          dimensionalStatus: 'Existing registered geometry; visually estimated finish' };
        applyReferenceFinish(variant); variants.set(material, variant); unused.add(material);
      }
      const key = gate6 ? 'gate6' : 'hall' + id;
      coverage[key] = (coverage[key] ?? 0) + 1;
      return variant;
    });
    object.material = Array.isArray(object.material) ? next : next[0];
  });
  root.traverse(object => {
    if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material])
      unused.delete(material);
  });
  unused.forEach(material => material.dispose());
  root.userData['referenceMaterialCoverage'] = coverage;
}

/** Called after palette copies as well, so factual surfaces cannot revert to
 * the old monochrome/salmon palette when a visitor switches appearance. */
export function applyReferenceFinish(material: T.MeshStandardMaterial): boolean {
  if (!material.userData['referenceMaterial']) return false;
  const finish = material.userData['referenceFinish'] as ReferenceFinish | undefined;
  if (finish) {
    material.color.set(finish.color); material.roughness = finish.roughness; material.metalness = finish.metalness;
    if (material.userData['architecturalCategory'] === 'glazing') material.envMapIntensity = .85;
  }
  return true;
}
