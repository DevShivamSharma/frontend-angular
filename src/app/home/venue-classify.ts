import * as T from 'three';
import type { Destination } from './venue.models';
import { isLegacyContextRoad } from './venue-edge-detail';

export function ancestorMatches(o: T.Object3D, re: RegExp): boolean {
    for (let n: T.Object3D | null = o; n; n = n.parent) if (re.test(n.name)) return true;
    return false;
}
/** Ground, paving and water: by name in the earlier model, by the Bharat Mandapam adapter's role in the new one. */
export function isVenueGround(o: T.Object3D): boolean {
    return ancestorMatches(o, /GROUND|paving|water|lawns|floor plan/i) || o.userData['venueRole'] === 'ground' || o.userData['venueRole'] === 'water';
}
/** CC parts that the CC level views clip. */
export function isVenueCC(o: T.Object3D): boolean {
    return ancestorMatches(o, /^PHOTO_CC|^PHOTO_Swept|^PHOTO_Ramp|^PHOTO_ROOF_SIGN_BOARD_CC|^ROOF_LABEL_CC|^ARCH_CC_SIGN/) || o.userData['destinationId'] === 'cc';
}
/** The destination (hall, gate, CC, fountain) a mesh belongs to, from glTF extras, adapter tags or the earlier names. */
export function createVenueClassifier(destinations: Destination[]): (o: T.Object3D) => string | null {
    const hallIds = new Set(destinations.filter(d => d.hall).map(d => String(d.hall)));
    const gateIds = new Set(destinations.filter(d => d.gate).map(d => d.id));
    return o => {
        for (let n: T.Object3D | null = o; n; n = n.parent) {
            if (n.userData['destinationId']) return n.userData['destinationId'] as string;
            if (gateIds.has(n.userData['gate_id'])) return n.userData['gate_id'] as string;
            if (n.userData?.['hall'] && hallIds.has(String(n.userData['hall'])))
                return 'hall' + n.userData['hall'];
            const h = n.name.match(/^(?:PHOTO_)?HALL_(12A|14|12|11|10|[1-9])(?:[ _]|$)|^ROOF_LABEL_H(12A|14|12|11|10|[1-9])$/);
            if (h)
                return 'hall' + (h[1] || h[2]);
            const sign = n.name.match(/^(?:ARCH_H|PHOTO_ROOF_SIGN_BOARD_H)(12A|14|12|11|10|[1-9])(?:_SIGN)?$/);
            if (sign)
                return 'hall' + sign[1];
            if (/^PHOTO_MUSICAL_FOUNTAIN/.test(n.name))
                return 'fountain';
            if (/^PHOTO_CC|^ROOF_LABEL_CC|^ARCH_CC/.test(n.name))
                return 'cc';
        }
        return null;
    };
}
/** What else must stay apart in a batch: ground (no shadow), CC (clipping), labels/glass, superseded or swappable layers. */
export function venueBatchSemantics(o: T.Mesh): string {
    return [
        isVenueGround(o),
        isVenueCC(o),
        /label|sign|glass|glazing|light|spray/i.test(o.name),
        isLegacyContextRoad(o),
        !!o.userData['supersededBySiteReference'],
        !!o.userData['mapSurroundingsReplacement']
    ].join(':');
}
