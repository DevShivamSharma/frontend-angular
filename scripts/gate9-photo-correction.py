"""Gate 9 photo correction: adjacent property and kiosk-side parking shelter.

Outside-gate photograph establishes the left-hand long stone building behind its
own wall. Dusk photograph is the reverse view of the curved entrance shelter.
All dimensions and camera poses are estimates, not a survey.
"""
import bpy
import math
from mathutils import Vector

# 18 October annotated kiosk view: entrance immediately RIGHT of the red kiosk.
# Gate-local a is right on entry; d runs into the venue. The far end approaches
# the office, instead of laying the shelter sideways against its facade.
SHELTER_A0, SHELTER_A1 = 9.0, 19.0
SHELTER_D0, SHELTER_D1 = 34.0, 62.0


def build(g):
    collections, created = g['collections'], g['created']
    # The old white context blocks are an inferred massing, superseded locally.
    for key in ('08', '15'):
        for obj in list(collections[key].objects):
            if obj in created: created.remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)
    c = bpy.data.collections.new('16 Photo left neighbouring property')
    bpy.context.scene.collection.children.link(c); collections['16'] = c; g['collection'] = c
    g['EVIDENCE'] = 'User Gate 9 outside photograph 2026-10-17; neighbouring property, estimated dimensions'
    gate, box, beam, mesh, M, V = [g[k] for k in ('gate','box','beam','mesh','M','V')]
    angle = g['ga']
    stone = [g['mat']('neighbour stone panel '+str(i), rgb) for i,rgb in enumerate([
        (.35,.265,.185),(.39,.30,.22),(.32,.24,.17),(.42,.33,.25)])]
    glazing = g['mat']('neighbour recessed blue windows',(.045,.095,.12),.32,.22)
    joint = g['mat']('neighbour stone joints',(.17,.14,.11))
    def block(name,a,d,h,size,material):
        return box('G9 neighbouring property '+name,gate(a,d,h),size,material,angle)
    # Long side of the neighbouring building, seen receding behind the left wall.
    # It stays entirely outside the entrance and the inner circulation road.
    block('stone body',-40,45,17.2,(25,102,34),stone[0])
    for level in range(9):
        bottom = 1.4 + level*3.55
        block('recessed side window ribbon',-27.43,45,bottom+1.12,(.08,100,1.38),glazing)
        block('recessed front window ribbon',-40,-6.08,bottom+1.12,(24,.08,1.38),glazing)
        # Protruding horizontal bands and staggered vertical stone piers make
        # real shadowed recesses, rather than painted square windows.
        block('side floor ledge',-27.0,45,bottom-.02,(1.0,102,.36),stone[level%4])
        block('front floor ledge',-40,-6.45,bottom-.02,(25,1,.36),stone[level%4])
        for j,d in enumerate(range(-4,96,6)):
            block('side stone pier',-27.02,d+(1.5 if level%2 else 0),bottom+1.12,(.95,.85,2.1),stone[(j+level)%4])
            for z in (bottom+2.0,bottom+2.65):
                beam('G9 neighbouring property stone course',gate(-26.96,d,z),gate(-26.96,min(d+6,96),z),.012,joint)
        for a in range(-51,-28,6):
            block('front stone pier',a+(.8 if level%2 else 0),-6.48,bottom+1.12,(.8,.9,2.1),stone[(level+1)%4])
        for d in range(-4,96,2):
            block('thin window mullion',-27.35,d,bottom+1.12,(.09,.035,1.38),M['dark'])
    block('roof coping',-40,45,34.35,(25.5,102.5,.3),stone[2])
    # Keep the neighbouring facade behind the existing front boundary (d=.45).
    # The original footprint started at d=-6 and buried the wall and railings.
    setback = gate(0,14,0) - gate(0,0,0)
    for obj in list(c.objects):
        obj.location += setback
    # Continuous property boundary: cream wall, sandstone coping/piers, railing,
    # clipped hedge on our side. It joins the narrow left gate, not the main lane.
    points=[(-19.4,1),(-22.8,12),(-23.2,45),(-23.2,95)]
    for (a,d),(b,e) in zip(points,points[1:]):
        beam('G9 left property plaster wall',gate(a,d,1.05),gate(b,e,1.05),.35,M['plaster'],1.6)
        beam('G9 left property sandstone coping',gate(a,d,1.89),gate(b,e,1.89),.47,M['red'],.13)
        for h in (2.05,2.7):beam('G9 left property railing rail',gate(a,d,h),gate(b,e,h),.045,M['dark'])
        n=max(1,int(math.hypot(b-a,e-d)/.22))
        for i in range(n+1):
            u=i/n;x=a+(b-a)*u;y=d+(e-d)*u
            beam('G9 left property railing upright',gate(x,y,1.94),gate(x,y,2.82),.025,M['dark'])
        n=max(1,int(math.hypot(b-a,e-d)/7))
        for i in range(n+1):
            u=i/n;x=a+(b-a)*u;y=d+(e-d)*u
            block('boundary pier',x,y,1.15,(.5,.5,1.85),M['plaster'])
            block('boundary pier cap',x,y,2.12,(.62,.62,.15),M['red'])
    for d in range(5,96,2):
        a=-21.6 if d>12 else -19.6
        block('roadside clipped hedge',a,d,.85,(1.1,2,1.1),M['hedge'])
    for d in (10,30,52,76,93):g['tree'](*g['gs'](-25,d),7.0)

    c=bpy.data.collections.new('17 Curved parking entrance shelter photo')
    bpy.context.scene.collection.children.link(c);collections['17']=c;g['collection']=c
    g['EVIDENCE']='User annotated kiosk view and three photographs, 2026-10-18: parking entrance immediately right of red kiosk; dimensions estimated'
    a0,a1,d0,d1=SHELTER_A0,SHELTER_A1,SHELTER_D0,SHELTER_D1
    width=a1-a0
    for da in (d0,d0+7,d0+14,d0+21):
        db=da+7
        vertices=[]
        for d in (da,db):
            for k in range(25):
                u=k/24
                vertices.append(gate(a0+width*u,d,3.55+1.45*math.sin(math.pi*u)))
        roof=mesh('G9 photo parking entrance cream curved roof',vertices,
                  [(k,k+1,k+26,k+25) for k in range(24)],M['cream'])
        for p in roof.data.polygons:p.use_smooth=True
        for d in (da,db):
            for k in range(24):
                u,v=k/24,(k+1)/24
                beam('G9 photo parking canopy arched rib',gate(a0+width*u,d,3.55+1.45*math.sin(math.pi*u)),gate(a0+width*v,d,3.55+1.45*math.sin(math.pi*v)),.065,M['white'])
            for a in (a0+.2,a1-.2):beam('G9 photo parking canopy white post',gate(a,d,.24),gate(a,d,3.55),.12,M['white'])
        for a in (a0,a1):beam('G9 photo parking canopy fascia',gate(a,da,3.5),gate(a,db,3.5),.08,M['cream'],.22)
    # Low enclosure and open mouth. No unseen underground garage is invented.
    for a in (a0+.2,a1-.2):
        beam('G9 photo parking shelter low side wall',gate(a,d0,.91),gate(a,d1,.91),.28,M['wall'],1.34)
        beam('G9 photo parking shelter wall coping',gate(a,d0,1.61),gate(a,d1,1.61),.38,M['ivory'],.09)
    beam('G9 photo parking shelter front left wall',gate(a0+.2,d0,.91),gate(a0+3,d0,.91),.28,M['wall'],1.34)
    beam('G9 photo parking shelter front right wall',gate(a0+6.7,d0,.91),gate(a1-.2,d0,.91),.28,M['wall'],1.34)
    mesh('SITE_GROUND_gate9 photo shelter floor',[gate(a,d,.26) for a,d in [(a0,d0),(a1,d0),(a1,d1),(a0,d1)]],[(0,1,2,3)],M['concrete'])
    # Flush apron joins the existing kiosk court; the opening faces the arrival.
    mesh('SITE_GROUND_gate9 photo shelter entry apron',[gate(a,d,.252) for a,d in [(a0,30),(a1,30),(a1,d0),(a0,d0)]],[(0,1,2,3)],M['concrete'])
    # Red ENTRY panel on the low wall, as visible in the dusk photo.
    entry=g['image_material']('photo parking ENTRY sign',g['SIGNS']/'entry-sign.png')
    entry_face=g['sign']('G9 photo shelter ENTRY sign',gate(a0+.5,d0-.16,.6),gate(a0+2,d0-.16,.6),gate(a0+2,d0-.16,1.45),gate(a0+.5,d0-.16,1.45),entry)
    # Gate-local across/inward axes face the arrival directly: retain the sign's
    # original UV orientation (the previous campus-axis placement needed a flip).
    for a in (a0+7.2,a0+8.5):
        box('G9 photo shelter red fire cabinet',gate(a,d0-.23,1.16),(.95,.28,.77),M['hydrant'],angle)
        box('G9 photo shelter fire cabinet window',gate(a,d0-.39,1.2),(.45,.025,.38),M['dark'],angle)
    # Photo 3 shows planting and a yellow/black kerb alongside the shelter.
    # Keep them on its outer side, beyond the open kiosk-side circulation lane.
    beam('G9 photo shelter planted side bed',gate(a1+1.1,d0+2,.29),gate(a1+1.1,d1,.29),1.6,M['soil'],.07)
    for i in range(40):
        d=d0+2+i*.65
        beam('G9 photo shelter side kerb',gate(a1+2,d,.33),gate(a1+2,min(d+.63,d1),.33),.24,M['yellow' if i%2 else 'black'],.18)
        for a in (a1+.6,a1+1.4):g['plant'](*g['gs'](a,d),.65 if a>a1+1 else .9)
    # Restore the clear frontage/turning pavement previously owned by collection15.
    pts=[(-509,-383),(-500,-393),(-440,-400),(-440,-383),(-487,-383),(-487,-347),(-501,-347),(-501,-373)]
    mesh('SITE_GROUND_gate9 photo office corner concrete',[V(*p,.258) for p in pts],[tuple(range(len(pts)))],M['concrete'])
    g['LIGHTS'][:]=[l for l in g['LIGHTS'] if not (l['kind']=='canopy' and -488<l['position'][0]<-476 and -380<l['position'][1]<-350)]
    for d in (d0+3,d0+10,d0+17,d0+25):
        box('G9 photo shelter warm light diffuser',gate((a0+a1)/2,d,4.3),(.55,.16,.035),M['light'],angle)
        g['LIGHTS'].append({'kind':'canopy','position':[*g['gs']((a0+a1)/2,d),4.2]})
    # Photo shows a narrow blue header above the kiosk's visible glazing.
    for obj in collections['09'].objects:
        if 'kiosk direction sign' in obj.name or 'kiosk sign backing' in obj.name:
            for v in obj.data.vertices:v.co.z=3.1+(v.co.z-2.0)*.55
    print('GATE9_PHOTO_CORRECTION: stone neighbouring property, boundary, curved shelter with open mouth')


def views(views,world,gate_world):
    views['gate9-photo-outside']={'position':gate_world(-4,-24,1.75),'target':gate_world(-2,14,4.2),'label':'Gate 9 · Photo entrance'}
    views['gate9-photo-shelter']={'position':gate_world(5,17,2.6),'target':gate_world(10,37,2.0),'label':'Gate 9 · Parking entrance right of kiosk'}
    views['gate9-photo-shelter-reverse']={'position':gate_world(7,59,1.75),'target':gate_world(13,34,2.0),'label':'Gate 9 · Shelter reverse view'}
    views['gate9-shelter-layout']={'position':gate_world(10,45,90),'target':gate_world(10,45,0),'label':'Gate 9 · Kiosk and parking layout'}
