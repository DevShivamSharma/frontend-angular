import { visitorGeometry } from './visitor-fixture';
import { prepareReferenceHall14 } from '../src/app/home/venue-reference-hall14';
import { prepareReferenceMaterials } from '../src/app/home/venue-reference-materials';
import { prepareReferenceConcourse } from '../src/app/home/venue-reference-concourse';
import { prepareReferenceCanopies } from '../src/app/home/venue-reference-canopy';

/** The same reference geometry corrections used by the shipping viewer. */
export function referenceVenueGeometry() {
  const root = visitorGeometry();
  prepareReferenceHall14(root); prepareReferenceMaterials(root);
  prepareReferenceConcourse(root); prepareReferenceCanopies(root);
  root.updateMatrixWorld(true);
  return root;
}
