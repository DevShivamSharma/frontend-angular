"""Gate-entry right view, registered approximately to the user's close photograph.

Gate-local a is right when entering; d is distance inward. No surveyed dimensions.
Keep this near-entry enclosure separate from the distant office-side walkway.
"""
import bpy
import math
import random
from mathutils import Vector


def build(g):
    collections, created = g['collections'], g['created']
    bpy.context.view_layer.update()
    # Replace the broad shelter displaced too far into the site by section 1.
    for o in list(collections['04'].objects):
        p = o.matrix_world @ (sum((Vector(v) for v in o.bound_box), Vector()) / 8)
        s = .5*p.x + .8660254038*p.y
        if s < -430:
            if o in created: created.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    g['LIGHTS'][:] = [l for l in g['LIGHTS'] if not
                     (l['kind'] == 'canopy' and l['position'][0] < -430)]
    c = bpy.data.collections.new('14 Entry right fenced shelter')
    bpy.context.scene.collection.children.link(c)
    collections['14'] = c
    g['collection'] = c
    g['EVIDENCE'] = 'User right-facing Gate 9 photograph, 2026-10-16; dimensions and camera pose estimated'
    gate, gs, beam, box, mesh, M = [g[k] for k in ('gate','gs','beam','box','mesh','M')]
    # Low sandstone plinth, square red piers, close black vertical bars.
    # The vehicle entrance remains clear: all fence geometry is a >= 16.8 m.
    for d0 in range(4, 40, 6):
        d1 = d0+6
        beam('G9 right fence sandstone plinth',gate(17,d0,.48),gate(17,d1,.48),.38,M['red'],.48)
        for d in (d0, d1):
            beam('G9 right fence sandstone pier',gate(17,d,.24),gate(17,d,3.05),.42,M['red'])
            box('G9 right pier coping',gate(17,d,3.08),(.48,.48,.09),M['red'],g['ga'])
        for h in (.87,1.65,2.63):
            beam('G9 right fence black rail',gate(17,d0,h),gate(17,d1,h),.045,M['dark'])
        for j in range(1, 34):
            d = d0+j*6/34
            beam('G9 right fence black picket',gate(17,d,.68),gate(17,d,2.91),.027,M['dark'])
    # Cream shallow barrel roof directly behind the fence; open dark underside.
    for d0 in range(5, 41, 6):
        vertices = []
        for d in (d0,d0+6):
            for k in range(17):
                u = k/16
                vertices.append(gate(18.2+8*u,d,2.95+.85*math.sin(math.pi*u)))
        roof = mesh('G9 right cream shelter roof',vertices,
                    [(k,k+1,k+18,k+17) for k in range(16)],M['cream'])
        roof.data.materials[0].use_backface_culling=False
        for d in (d0,d0+6):
            for k in range(16):
                u,v=k/16,(k+1)/16
                beam('G9 right shelter roof rib',gate(18.2+8*u,d,2.95+.85*math.sin(math.pi*u)),
                     gate(18.2+8*v,d,2.95+.85*math.sin(math.pi*v)),.035,M['dark'])
            for a in (18.2,26.2):
                beam('G9 right shelter support',gate(a,d,.24),gate(a,d,2.95),.08,M['dark'])
    # Local concrete court seen across the road; preserve the connected asphalt lane.
    pts=[(7,4),(16.7,4),(16.7,42),(8,42),(6,29),(5,17)]
    mesh('SITE_GROUND_gate9 right concrete court',[gate(a,d,.244) for a,d in pts],
         [(0,i,i+1) for i in range(1,len(pts)-1)],M['concrete'])
    pts=[(6,5),(10,5),(11,9),(9,14),(6,15),(5,10)]
    mesh('SITE_GROUND_gate9 right worn surface',[gate(a,d,.247) for a,d in pts],
         [(0,i,i+1) for i in range(1,len(pts)-1)],M['wet'])
    # Planting beds at the fence ends, leaving the turn unobstructed.
    rng=random.Random(914)
    for d0,d1 in ((5,11),(34,41)):
        beam('G9 right planted bed',gate(15.5,d0,.28),gate(15.5,d1,.28),1.6,M['soil'],.06)
        for j in range(int((d1-d0)/.65)):
            d=d0+j*.65
            beam('G9 right alternating kerb',gate(14.55,d,.33),gate(14.55,d+.63,.33),.23,
                 M['yellow' if j%2 else 'black'],.18)
            for a in (15.1,15.8):g['plant'](*gs(a,d),rng.uniform(.65,1.05))
    for a,d,h in ((28,6,6.5),(29,14,7),(28,23,6.8),(29,33,7.6),(28,43,7)):
        g['tree'](*gs(a,d),h)
    # Existing lamp style, kept outside the driving route.
    g['lamp'](*gs(11,23),.5,.3)
    planting_screen(g)
    print('GATE9_RIGHT_CORNER: near-entry fence, cream shelter and planted concrete court')


def planting_screen(g):
    # Dense layered vegetation, as observed above and between the roof bays.
    # This screens the existing distant architecture without moving it.
    gs = g['gs']
    for d in range(7, 46, 5):
        for a,h in ((27.6,4.3),(30.2,6.4)):
            g['tree'](*gs(a,d),h)
    gate, mesh, M = g['gate'],g['mesh'],g['M']
    vertices=[gate(5.8,18,.28)]
    vertices += [gate(5.8+2.1*math.cos(j*math.tau/24),18+3.4*math.sin(j*math.tau/24),.28)
                 for j in range(24)]
    mesh('G9 right rounded planting bed',vertices,[(0,j+1,(j+1)%24+1) for j in range(24)],M['soil'])
    for j in range(24):
        angle=j*math.tau/24
        for r in (.55,.9):
            g['plant'](*gs(5.8+r*2.1*math.cos(angle),18+r*3.4*math.sin(angle)),1.1)


def views(views, gate):
    def w(a,d,h):
        p=gate(a,d,h)
        return [p.x,p.z,-p.y]
    views['gate9-entry-right'] = {
        'position':w(3,7,1.85),'target':w(20,14,2.05),
        'label':'Gate 9 · Right after entering'}
