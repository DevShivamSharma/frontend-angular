"""19 October user correction: left road meets left gate, tower at outer left.

Gate-local a increases right from outside. Keep the photographed road/shelters
fixed; move the entrance furniture toward that road, not the other way around.
"""
import bpy
import json
from mathutils import Vector

SHIFT=12.0
LEFT_CENTER=-3.1


def build(g):
    gate,gs,beam,box,mesh,M=[g[k] for k in ('gate','gs','beam','box','mesh','M')]
    origin=gate(0,0,0);right=gate(1,0,0)-origin;forward=gate(0,1,0)-origin
    cleared_planting=[]
    def local(p):
        q=p-origin
        return q.dot(right),q.dot(forward),p.z
    def transform(o,fn):
        inv=o.matrix_world.inverted()
        for v in o.data.vertices:
            a,d,z=local(o.matrix_world@v.co);v.co=inv@gate(*fn(a,d,z))
    def discard(o):
        if o in g['created']:g['created'].remove(o)
        bpy.data.objects.remove(o,do_unlink=True)
    bpy.context.view_layer.update()
    for c in list(g['collections'].values()):
        for o in list(c.objects):
            n=o.name
            if o.type=='EMPTY' and n.startswith('GATE9_moving_leaf_'):
                o.location+=right*SHIFT
            elif o.type=='MESH' and not o.parent:
                if 'leaf_canopy ground planting' in n:
                    a,d,z=local(o.matrix_world@(sum((Vector(v) for v in o.bound_box),Vector())/8))
                    centre=-5.2 if d<=48 else -5.2+(d-48)*2.7/24
                    if 23<d<74 and abs(a-centre)<3.0:
                        cleared_planting.append({'name':n,'a':round(a,3),'d':round(d,3),
                                                'exportBatch':'G9 leaf_canopy '+c.name+' '+o.data.materials[0].name})
                        discard(o)
                elif n.startswith(('G9 checking room','SITE_GROUND_gate9 checking ramp')):
                    # Hold the front doorway at d=-2.1; extend rear to d=6.3.
                    transform(o,lambda a,d,z:(a+SHIFT,2*d+2.1,z))
                elif n.startswith(('G9 lookout stair','G9 lookout landing')):
                    # Stair rises toward the gate; its foot stays inside the boundary.
                    transform(o,lambda a,d,z:(a+2.6,10.6-d,z))
                elif n.startswith(('G9 lookout side','G9 red security cabin','G9 cabin overhanging roof','G9 cabin glass','G9 cabin mullion')):
                    transform(o,lambda a,d,z:(a+2.6,d-7.4,z))
                elif n.startswith(('GATE9_barrier_arm_',)):
                    o.location+=right*SHIFT
                elif n.startswith(('G9 gate post','G9 barrier cabinet')):
                    transform(o,lambda a,d,z:(a+SHIFT,d,z))
                elif n.startswith(('G9 yellow barricade','G9 barricade ')):
                    transform(o,lambda a,d,z:(a+8,d-.9,z))
                elif n.startswith(('G9 pink plastic barrier','G9 moulded barrier slot')):
                    transform(o,lambda a,d,z:(a+10,d,z))
                elif n.startswith(('G9 inside green bin','G9 inside bin','G9 traffic cone')) and c==g['collections']['19']:
                    transform(o,lambda a,d,z:(a+SHIFT,2*d+2.1,z))
                elif n.startswith(('G9 fixed fence','G9 boundary base')) and c==g['collections']['02']:
                    # Replace the old broad right return, which occupied the new opening.
                    a,d,z=local(o.matrix_world@(sum((Vector(v) for v in o.bound_box),Vector())/8))
                    if 1.3<a<19:discard(o)
    # Keep the former full-width apron from implying another lane on the right.
    for o in list(g['collections']['19'].objects):
        if any(x in o.name for x in ('entry concrete apron','old road repair','cement weathering','construction joint','irregular surface crack','manhole','utility cover')):
            discard(o)
    c=bpy.data.collections.new('20 Corrected gate alignment and left road')
    bpy.context.scene.collection.children.link(c);g['collections']['20']=c;g['collection']=c
    g['EVIDENCE']='19 October annotated screenshots: tower at extreme left, longer checking room, left road aligned to left gate'
    for a0,a1 in [(13.4,19),(-19.2,-9.7)]:
        beam('G9 corrected boundary base',gate(a0,.45,.57),gate(a1,.45,.57),.5,M['red'],.65)
        for i in range(int((a1-a0)/.2)+1):
            a=a0+i*.2;beam('G9 corrected fence bar',gate(a,.45,.8),gate(a,.45,3.1),.045,M['dark'])
        for z in (1.1,2.85):beam('G9 corrected fence rail',gate(a0,.45,z),gate(a1,.45,z),.065,M['dark'])
    cement=bpy.data.materials['G9 entrance weathered cement']
    repair=bpy.data.materials['G9 entrance old aggregate repair']
    joint=bpy.data.materials['G9 entrance hairline cracks']
    def floor(name,points,z,material):
        o=mesh('SITE_GROUND_gate9 '+name,[gate(a,d,z) for a,d in points],[tuple(range(len(points)))],material)
        uv=o.data.uv_layers.new(name='Entrance metres')
        for p in o.data.polygons:
            for li in p.loop_indices:
                a,d=points[o.data.loops[li].vertex_index];uv.data[li].uv=(a/4,d/4)
    floor('aligned two lane apron',[(-7,-5),(13.3,-5),(13.3,.9),(16.7,.9),
          (16.7,29),(7,29),(7,23),(-7.7,23),(-7.7,8),(-7,4)],.309,cement)
    # The left lane follows the annotated sightline past the left of the kiosk.
    floor('left gate straight road',[(-6.6,0),(.4,0),(-2.7,28),(-2.7,48),
          (-.1,70),(-4.9,74),(-7.7,48),(-7.7,28)],.311,cement)
    floor('aligned street repair',[(-6.8,-10),(1,-10.6),(7,-9.6),(14,-10.3),
          (14,-5.1),(6,-5.9),(-1,-5.1),(-6.8,-5.7)],.312,repair)
    for d,a0,a1 in [(-4,-6.8,13.2),(9,-7.5,16.5),(20,-7.5,16.5),(31,-7.5,-2.9),(43,-7.5,-2.9)]:
        beam('SITE_GROUND_gate9 aligned road joint',gate(a0,d,.314),gate(a1,d,.314),.015,joint,.002)
    for a,d in [(-3,-8),(-4,16),(11.5,15),(-5,38)]:
        box('SITE_GROUND_gate9 aligned inset cover',gate(a,d,.319),(.9,1.1,.012),M['dark'],g['ga'])
        for offset in (-.3,-.1,.1,.3):
            beam('SITE_GROUND_gate9 aligned cover rib',gate(a+offset,d-.45,.328),gate(a+offset,d+.45,.328),.018,M['steel'],.004)
    # Close the obsolete tower/court footprint with a planted margin beside the road.
    floor('left landscaped margin',[(-19,5),(-11.7,5),(-8.7,8),(-8.7,26),(-17,26)],.312,M['hedge'])
    for d in range(9,26):
        beam('G9 left road alternating kerb',gate(-8.2,d,.38),gate(-8.2,d+.98,.38),.24,M['yellow' if d%2 else 'black'],.19)
        g['plant'](*gs(-9,d),.8);g['plant'](*gs(-10,d),.9)
    for light in g['LIGHTS']:
        if light['kind']=='cabin':
            s,t,z=light['position'];light['position']=[s+g['R'][0]*SHIFT,t+g['R'][1]*SHIFT,z]
    report={'gateShiftRightMetres':SHIFT,'leftGateCentre':[-3.1,0],
            'rightGateCentre':[9,0],'watchtowerCentre':[-8.4,1.6],
            'checkingCabin':{'width':3.4,'depth':8.4,'frontD':-2.1,'rearD':6.3},
            'leftRoadCentreline':[[-3.1,0],[-5.2,28],[-5.2,48],[-2.5,72]],
            'plantingClearedFromRoad':cleared_planting,
            'reference':'19 October annotated road-to-left-gate screenshots; dimensions estimated'}
    (g['WORK']/'gate-alignment.json').write_text(json.dumps(report,indent=2))
    print('GATE9_ALIGNMENT',json.dumps(report))


def views(views,world):
    for key,p,t,label in [
        ('gate9-approach',(3,-25,1.9),(3,0,2),'Gate 9 · Corrected entrance'),
        ('gate9-entry-overview',(-27,-33,33),(2,17,0),'Gate 9 · Aligned left road'),
        ('gate9-checking-room',(3.26,-6,1.85),(3.26,8,1.85),'Gate 9 · Extended checking passage'),
        ('gate9-left-road',(-3.1,2,1.85),(-5.2,40,1.85),'Gate 9 · Left gate to campus road'),
        ('gate9-left-road-reverse',(-4.5,48,2.0),(-3.1,0,2),'Gate 9 · Road meets left gate'),
        ('gate9-video-lookout',(-15,-5,2),(-8.4,1.6,3),'Gate 9 · Tower at left gate edge')]:
        views[key]={'position':world(*p),'target':world(*t),'label':label}
