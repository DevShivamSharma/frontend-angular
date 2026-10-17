"""Office-front corner registered from the user's sequential walkthrough crops.
Dimensions remain estimates. The office footprint and halls are untouched.
"""
import bpy
import math
from mathutils import Vector


def build(g):
    collections,created=g['collections'],g['created']
    bpy.context.view_layer.update()
    # Retire the old diagonal lane kerbs and shelter tail crossing the new turn.
    for key in ('03','14'):
        for o in list(collections[key].objects):
            if o.type!='MESH':continue
            p=o.matrix_world @ (sum((Vector(v) for v in o.bound_box),Vector())/8)
            s,t=.5*p.x+.8660254038*p.y,.8660254038*p.x-.5*p.y
            d=(s-g['GATE'][0])*g['F'][0]+(t-g['GATE'][1])*g['F'][1]
            old_kerb=(key=='03' and 'kerb' in o.name and
                      ((-512<s<-486 and -395<t<-347) or (-486<=s<-440 and -399<t<-383)))
            old_tail=(key=='14' and d>29 and any(token in o.name for token in
                      ('shelter','right fence','right pier','planted bed','alternating kerb','ground planting')))
            if old_kerb or old_tail:
                if o in created:created.remove(o)
                bpy.data.objects.remove(o,do_unlink=True)
    # Remove the dense trees previously inferred in what is actually a clear turn.
    for key in ('05','09','12','14'):
        for o in list(collections[key].objects):
            if o.type!='MESH':continue
            p=o.matrix_world @ (sum((Vector(v) for v in o.bound_box),Vector())/8)
            s,t=.5*p.x+.8660254038*p.y,.8660254038*p.x-.5*p.y
            planting=any(word in o.name for word in ('leaf_canopy','tree','branch','hedge'))
            if (planting and -510<s<-475 and -390<t<-340) or (key=='09' and 'hydrant' in o.name):
                if o in created:created.remove(o)
                bpy.data.objects.remove(o,do_unlink=True)
    c=bpy.data.collections.new('15 Office front canopy and clear corner')
    bpy.context.scene.collection.children.link(c);collections['15']=c;g['collection']=c
    g['EVIDENCE']='User sequential Gate 9 office-corner crops, 2026-10-17; unsurveyed dimensions'
    V,mesh,beam,box,M=[g[k] for k in ('V','mesh','beam','box','M')]
    # L-shaped concrete circulation: frontage court joins the existing office lane.
    points=[(-509,-383),(-500,-393),(-440,-400),(-440,-383),(-487,-383),(-487,-347),(-501,-347),(-501,-373)]
    mesh('SITE_GROUND_gate9 office corner concrete',[V(*p,.258) for p in points],
         [tuple(range(len(points)))],M['concrete'])
    # Broad cream shelter along the short office frontage; the adjacent long lane
    # remains open, as shown in the next frame of the walkthrough.
    for t0 in (-379,-372,-365,-358):
        vertices=[]
        for t in (t0,t0+7):
            for k in range(17):
                u=k/16
                vertices.append(V(-487+10*u,t,3.7+1.05*math.sin(math.pi*u)))
        roof=mesh('G9 office front cream canopy',vertices,
                  [(k,k+1,k+18,k+17) for k in range(16)],M['cream'])
        roof.data.materials[0].use_backface_culling=False
        for t in (t0,t0+7):
            for k in range(16):
                u,v=k/16,(k+1)/16
                beam('G9 office front canopy rib',V(-487+10*u,t,3.7+1.05*math.sin(math.pi*u)),
                     V(-487+10*v,t,3.7+1.05*math.sin(math.pi*v)),.055,M['white'])
            for s in (-486.7,-477.3):
                beam('G9 office front white support',V(s,t,.24),V(s,t,3.7),.14,M['white'])
    # Low weathered concrete wall wraps the near corner and carries paired boxes.
    beam('G9 office canopy low wall',V(-486.8,-379,.87),V(-486.8,-351,.87),.3,M['wall'],1.22)
    beam('G9 office canopy end wall',V(-486.8,-379,.87),V(-477,-379,.87),.3,M['wall'],1.22)
    for s in (-483.6,-482.3):
        box('G9 office corner fire cabinet',V(s,-379.2,1.2),(1.0,.25,.85),M['hydrant'],math.pi/3)
        box('G9 fire cabinet dark window',V(s,-379.34,1.24),(.55,.025,.44),M['dark'],math.pi/3)
        box('G9 fire cabinet white label',V(s,-379.36,1.33),(.22,.015,.10),M['white'],math.pi/3)
    # Canopy floor and planted inner edge, all behind the low wall.
    mesh('SITE_GROUND_gate9 office canopy deck',[V(s,t,.26) for s,t in
         [(-486.6,-378.8),(-477,-378.8),(-477,-351),(-486.6,-351)]],[(0,1,2,3)],M['concrete'])
    for t in range(-377,-351):g['plant'](-478.2,t,.65)
    # Continue the previously modelled right-hand railing alongside this lane.
    for t0 in (-382,-375,-368,-361,-354):
        t1=t0+7
        beam('G9 corner fence red base',V(-502,t0,.48),V(-502,t1,.48),.35,M['red'],.48)
        for t in (t0,t1):beam('G9 corner fence red pier',V(-502,t,.24),V(-502,t,3.05),.4,M['red'])
        for h in (.9,1.7,2.65):beam('G9 corner fence rail',V(-502,t0,h),V(-502,t1,h),.045,M['dark'])
        for j in range(1,40):
            t=t0+j*7/40
            beam('G9 corner fence picket',V(-502,t,.7),V(-502,t,2.95),.027,M['dark'])
    for t in range(-378,-351,7):
        g['LIGHTS'].append({'kind':'canopy','position':[-482,t,3.8]})
    # Rounded hedge at the junction, outside the broad clear turning surface.
    for j in range(16):
        a=j*math.pi/30
        s,t=-477.2-2.2*math.cos(a),-380.3-2.2*math.sin(a)
        g['plant'](s,t,.75)
    # Concrete joints and flush covers do not create movement blockers.
    for t in (-374,-367,-360):
        beam('SITE_GROUND_gate9 corner expansion joint',V(-500,t,.260),V(-487.2,t,.260),.012,M['joint'],.002)
    for s,t in ((-495,-374),(-469,-394)):
        box('SITE_GROUND_gate9 corner access cover',V(s,t,.262),(.8,.65,.006),M['wall'],math.pi/3)
    print('GATE9_OFFICE_CORNER: clear turn, office-front canopy, low wall, paired fire cabinets')


def views(views,world):
    views['gate9-office-corner']={'position':world((-499,-388,1.75)),
        'target':world((-491,-354,2.0)),'label':'Gate 9 · Office canopy corner'}
    views['gate9-office-lane']={'position':world((-495,-390,1.75)),
        'target':world((-448,-390,1.9)),'label':'Gate 9 · Beside the office'}
