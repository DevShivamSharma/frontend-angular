"""User correction: left is the property boundary; canopies belong on the right.

The translation is an editable initial registration from the annotated screenshot,
not a measured site coordinate. CC parking is deliberately not invented here.
"""
import bpy
from mathutils import Vector

SHIFT = (16, 73)

def correct_section(g):
    bpy.context.view_layer.update()
    collections, created, V = g['collections'], g['created'], g['V']
    delta = V(*SHIFT, 0)
    moved = removed = 0

    def centre(o):
        p = o.matrix_world @ (sum((Vector(v) for v in o.bound_box), Vector()) / 8)
        return (.5*p.x + .8660254038*p.y, .8660254038*p.x - .5*p.y)

    def discard(o):
        nonlocal removed
        if o in created: created.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
        removed += 1

    def relocate(o):
        nonlocal moved
        o.location += delta
        o['evidence'] = 'User annotated correction, 2026-10-16: right-side canopies; exact placement estimated'
        moved += 1

    for o in list(collections['10'].objects): discard(o)
    collections['10'].name = '10 Parking removed here — belongs near CC'
    for o in list(collections['04'].objects):
        if 'shelter fence' in o.name: discard(o)
        else: relocate(o)
    for key in ('05', '06', '09', '11', '12'):
        for o in list(collections[key].objects):
            if o.type != 'MESH': continue
            s, t = centre(o)
            left = -518 < s < -360 and t < -400
            if key == '05' and left:
                # Clear the incorrectly populated strip beside the boundary road.
                discard(o)
            elif key == '06' and -518 < s < -360 and t < -398 and ('lamp' in o.name):
                relocate(o)
            elif key == '09' and left:
                if s < -500: discard(o)
                else: relocate(o)
            elif key == '11' and o.name.startswith(('G9 pavilion', 'G9 entry ', 'G9 walkway', 'SITE_GROUND_gate9 walkway')):
                relocate(o)
            elif key == '12' and left:
                relocate(o)
    g['LIGHTS'][:] = [light for light in g['LIGHTS']
                     if not (light['kind'] == 'lamp' and light['position'][0] < -500 and light['position'][1] < -400)]
    for light in g['LIGHTS']:
        s, t, h = light['position']
        if -518 < s < -360 and (t < -400 or (light['kind'] == 'lamp' and t < -398)):
            light['position'] = [s+SHIFT[0], t+SHIFT[1], h]
            if 'aim' in light:
                a, b, z = light['aim']; light['aim'] = [a+SHIFT[0], b+SHIFT[1], z]

    c = bpy.data.collections.new('13 Left property boundary — user correction')
    bpy.context.scene.collection.children.link(c); collections['13'] = c
    g['collection'] = c
    g['EVIDENCE'] = 'User section-one annotated screenshot: boundary left of this road; height and alignment estimated'
    beam, M = g['beam'], g['M']
    points = [(-511,-400),(-498,-403),(-380,-403),(-365,-397)]
    for a, b in zip(points, points[1:]):
        beam('G9 property boundary wall', V(*a,.99), V(*b,.99), .28, M['plaster'], 1.5)
        beam('G9 property boundary coping', V(*a,1.77), V(*b,1.77), .36, M['plaster'], .10)
        beam('G9 property boundary top rail', V(*a,2.25), V(*b,2.25), .045, M['dark'])
    for p, direction in g['samples']([Vector(p) for p in points], .25):
        beam('G9 property boundary railing', V(*p,1.8), V(*p,2.25), .025, M['dark'])
    print('GATE9_SECTION1', {'relocated':moved, 'removed':removed, 'parking':'removed from Gate 9; CC placement deferred'})

def correct_views(views, world):
    for key in ('gate9-canopy','gate9-walkway','gate9-video-entry'):
        delta = world((*SHIFT,0))
        for field in ('position','target'):
            views[key][field] = [a+b for a,b in zip(views[key][field],delta)]
    views['gate9-parking'] = {'position':world((-478,-394,2)), 'target':world((-450,-403,2)), 'label':'Gate 9 · Property boundary'}
    views['gate9-video-turn'] = {'position':world((-386,-321,1.8)), 'target':world((-376,-331,2)), 'label':'Gate 9 · Right-side garden details'}
    views['gate9-section1'] = {'position':world((-535,-435,220)), 'target':world((-449,-365,1)), 'label':'Gate 9 · Section 1 overview'}
