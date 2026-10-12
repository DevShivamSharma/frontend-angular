"""Reconcile only the inferred surroundings that overlap the photographed court.

The retained portions are copied from the existing site layer, not redesigned.
The setback is an estimate; it does not establish a surveyed building footprint.
"""
import bpy, bmesh
from mathutils import Vector, Matrix

PREFIXES = ('SITE_northwest-office-courtyard-wing_', 'SITE_northwest-office-link_')
COURT_EDGE_T = -444.0


def reconcile_context(asset, collection):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(asset))
    imported = set(bpy.data.objects) - before
    kept = []
    for obj in imported:
        if obj.type != 'MESH' or not obj.name.startswith(PREFIXES):
            continue
        source_name = obj.name
        # Bake the imported world transform before using the campus-local plane.
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.data = obj.data.copy()
        obj.data.transform(world)
        obj.matrix_world = Matrix.Identity(4)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        normal = Vector((.8660254038, -.5, 0))
        result = bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            dist=.0001, plane_co=normal * COURT_EDGE_T, plane_no=normal,
            clear_outer=True, clear_inner=False)
        # Close the new cut so the remaining mass is solid, including its roof.
        edges = [edge for edge in result['geom_cut']
                 if isinstance(edge, bmesh.types.BMEdge) and edge.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        if not obj.data.polygons:
            continue
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
        obj.name = 'G9 retained context ' + source_name.removeprefix('SITE_')
        obj['sourceObject'] = source_name
        obj['evidence'] = 'Existing inferred site context; local canopy clearance estimated from photos 1 and 4'
        obj['estimatedCourtEdgeT'] = COURT_EDGE_T
        kept.append(obj)
    bpy.data.batch_remove(imported - set(kept))
    return kept
