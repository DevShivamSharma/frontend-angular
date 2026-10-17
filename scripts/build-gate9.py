"""Gate 9 photographic reconstruction. Blender 5.x, no test runner.

The supplied venue is imported only as a locked reference; only Gate 9 detail
is exported. Dimensions are editable estimates, recorded in reference.json.

2026-10-15 extension (work/gate9/references/2026-10-15/, ten photos and a video):
khaki sliding gates, two boom barriers, checking cabin left of the vehicle gate,
floodlight mast, direction kiosk on a fork island, hedges, fenced parking shelters
with cars, the office-front drop-off (granite setts, plumeria island, ITPO barrier
sign, ENTRY pavilion and arched walkway) and the lamp list used for night lighting.
Sign lettering comes from scripts/gate9-signs.ps1 (work/gate9/signs/*.png).
"""
import bpy, math, json, random, hashlib, runpy
from pathlib import Path
from mathutils import Vector, Matrix
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / 'work/gate9'
ASSETS = ROOT / 'src/assets/venue'
WORK.mkdir(exist_ok=True, parents=True)
random.seed(9026)
GATE = (-542.692, -363.315)
F = (.894427191, -.447213596)
R = (.447213596, .894427191)
source = ASSETS / 'IITF_2026_ARCHITECTURAL.glb'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
context = bpy.data.collections.new('00 Existing venue — LOCKED REFERENCE')
bpy.context.scene.collection.children.link(context)
for o in list(bpy.context.scene.objects):
    for c in list(o.users_collection): c.objects.unlink(o)
    context.objects.link(o)
    o.hide_select = True
    if o.name.startswith(('PHOTO_GATE_9', 'GATE_9_SIGN', 'PHOTO_ADMIN')):
        o.hide_render = True
        o.hide_set(True)

collections = {}
for name in ['01 Approach road', '02 Gate and security', '03 Interior lanes', '04 Canopies', '05 Planting', '06 Street furniture', '07 Photo cameras', '08 Local context reconciliation']:
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    collections[name[:2]] = c
collection = collections['01']
created = []

def V(s, t, h=0):
    return Vector((.5*s+.8660254038*t, .8660254038*s-.5*t, h))

def gate(a, d, h=0):
    return V(GATE[0]+R[0]*a+F[0]*d, GATE[1]+R[1]*a+F[1]*d, h)

def gs(a, d):
    """Gate-local (a across, d inward) to campus (s, t)."""
    return (GATE[0]+R[0]*a+F[0]*d, GATE[1]+R[1]*a+F[1]*d)

def mat(name, color, rough=.85, metal=0):
    m = bpy.data.materials.new('G9 '+name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    return m

M = {
    'concrete': mat('brushed warm concrete', (.32,.31,.265)),
    'asphalt': mat('weathered asphalt', (.095,.104,.098)),
    'yellow': mat('aged yellow kerb paint', (.59,.36,.018)),
    'black': mat('charcoal kerb paint', (.024,.029,.026)),
    'steel': mat('galvanized silver gate', (.37,.395,.35), .48,.65),
    'dark': mat('painted dark metal', (.038,.049,.045),.52,.3),
    'red': mat('security booth sandstone', (.28,.105,.067)),
    'cream': mat('weathered tensile fabric', (.62,.59,.45)),
    'wall': mat('stained concrete shelter wall', (.32,.32,.26)),
    'glass': mat('security glazing', (.065,.115,.12),.23,.4),
    'white': mat('worn ivory road paint', (.68,.68,.56)),
    'pink': mat('pink moulded barrier', (.43,.071,.112)),
    'soil': mat('planted earth', (.075,.066,.031)),
    'trunk': mat('tree bark', (.115,.083,.046)),
    'green': mat('green litter bin', (.022,.102,.032)),
    'wet': mat('damp concrete patches', (.17,.185,.158),.32),
    'joint': mat('expansion joints', (.11,.117,.105)),
    'light': mat('lamp diffuser', (.75,.73,.56),.35)
}
for i,c in enumerate([(.026,.088,.011),(.046,.134,.015),(.083,.188,.024),(.14,.24,.032)]):
    M['leaf'+str(i)] = mat('leaf tone '+str(i), c, .8)
M['light'].node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(1,.8,.48,1)
M['light'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.45
# 2026-10-15 photo materials. Lamp/sign glow is driven at runtime (venue-night-lights.ts)
# by material name, so every lit surface keeps the word "diffuser", "glazing" or "sign".
M.update({
    'khaki': mat('painted khaki gate steel', (.30,.29,.185), .55, .35),
    'boom': mat('boom barrier white', (.80,.80,.74), .5, .1),
    'boomred': mat('boom barrier red band', (.55,.06,.05), .5),
    'hedge': mat('clipped green hedge', (.06,.15,.035), .9),
    'sett': mat('granite sett paving', (.21,.215,.21), .9),
    'sandstone': mat('red sandstone kiosk', (.30,.11,.07), .85),
    'kioskglass': mat('kiosk glazing', (.25,.35,.38), .2, .3),
    'blue': mat('blue sign board back', (.05,.18,.45), .5),
    'chrome': mat('stainless steel frame', (.6,.62,.6), .25, .9),
    'ivory': mat('ivory canopy wall', (.72,.68,.56), .8),
    'hydrant': mat('red fire hydrant box', (.6,.05,.04), .5),
    'cone': mat('orange traffic cone', (.9,.3,.05), .6),
    'pot': mat('terracotta pot', (.5,.22,.12), .8),
    'plumeria': mat('plumeria leaves', (.12,.3,.08), .8),
    'cream2': mat('weathered tensile fabric band', (.5,.47,.36)),
    'flood': mat('floodlight diffuser', (.8,.8,.7), .3),
    'car_white': mat('car paint white', (.85,.85,.82), .35, .2),
    'car_silver': mat('car paint silver', (.55,.56,.58), .35, .5),
    'car_grey': mat('car paint dark grey', (.12,.13,.14), .35, .4),
    'car_maroon': mat('car paint maroon', (.35,.05,.06), .35, .3),
    'car_glass': mat('car glazing', (.08,.1,.12), .15, .5),
})
M['cream2'].use_backface_culling=False
M['flood'].node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(1,.95,.85,1)
M['flood'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.45
CARS=['car_white','car_white','car_silver','car_grey','car_maroon']
def image_material(name, path, emissive=0):
    m=mat(name,(1,1,1)); nt=m.node_tree; bs=nt.nodes.get('Principled BSDF')
    image=bpy.data.images.load(str(path)); image.pack()
    image['source']='Lettering transcribed from the 2026-10-15 photographs; rendered by scripts/gate9-signs.ps1'
    tex=nt.nodes.new('ShaderNodeTexImage'); tex.image=image
    nt.links.new(tex.outputs['Color'],bs.inputs['Base Color']); nt.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    m.surface_render_method='DITHERED'
    if emissive:
        nt.links.new(tex.outputs['Color'],bs.inputs['Emission Color']); bs.inputs['Emission Strength'].default_value=emissive
    return m
SIGNS=WORK/'signs'
LIGHTS=[]   # runtime night lighting: {kind, position (campus s,t,h), aim (campus) optional}
EVIDENCE='Photos 1,2,4,5,6; scale and hidden geometry estimated'

def surface_texture(key, scale):
    rng = np.random.default_rng(9)
    size = 512
    noise = rng.normal(0,.018 if key=='concrete' else .013,(size,size))
    if key=='concrete': noise += np.sin(np.arange(size)[:,None]*1.62)*.009
    colors = np.array(M[key].diffuse_color[:3])
    # Blender image pixels use scene-linear colour, saved as sRGB PNG.
    pixels = np.ones((size,size,4),dtype=np.float32)
    pixels[:,:,:3] = np.clip(colors[None,None,:]+noise[:,:,None],.008,1)
    im=bpy.data.images.new('G9 '+key+' grain',width=size,height=size)
    im.pixels.foreach_set(pixels.ravel())
    im.filepath_raw=str(WORK/(key+'.png')); im.file_format='PNG'; im.save(); im.pack()
    nt=M[key].node_tree
    tx=nt.nodes.new('ShaderNodeTexImage');tx.image=im
    nt.links.new(tx.outputs['Color'],nt.nodes.get('Principled BSDF').inputs['Base Color'])
surface_texture('concrete',4)
surface_texture('asphalt',3)

def mesh(name, verts, faces, material):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);collection.objects.link(o);data.materials.append(material)
    created.append(o)
    o['evidence']=EVIDENCE
    if material in (M['concrete'],M['asphalt'],M['sett']):
        uv=data.uv_layers.new(name='Surface metres')
        for loop in data.loops:
            co=data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=(co.x/4,co.y/4)
    return o

def box(name, p, size, material, angle=0):
    x,y,z=[s/2 for s in size];c=math.cos(angle);s=math.sin(angle)
    v=[(p[0]+a*c-b*s,p[1]+a*s+b*c,p[2]+h) for a,b,h in [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]]
    return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material)

def beam(name,a,b,width,material,depth=None):
    a=Vector(a);b=Vector(b);axis=(b-a).normalized()
    side=axis.cross(Vector((0,0,1)))
    if side.length<.001:side=Vector((1,0,0))
    side.normalize();up=axis.cross(side).normalized()
    v=[p+side*x*width/2+up*y*(depth or width)/2 for p in (a,b) for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material)

def cylinder(name,p,r,h,material,n=10):
    v=[(p[0]+r*math.cos(i*2*math.pi/n),p[1]+r*math.sin(i*2*math.pi/n),p[2]+z) for z in [-h/2,h/2] for i in range(n)]
    return mesh(name,v,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],material)

def samples(points,spacing):
    carry=0
    for a,b in zip(points,points[1:]):
        a=Vector(a);b=Vector(b);d=b-a;length=d.length
        while carry<length:
            yield a+d*(carry/length),d.normalized()
            carry+=spacing
        carry-=length

def smooth(points,steps=8):
    points=[Vector(p) for p in points];out=[]
    for i in range(len(points)-1):
        a=points[max(0,i-1)];b=points[i];c=points[i+1];d=points[min(len(points)-1,i+2)]
        for j in range(steps):
            t=j/steps
            out.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
    return out+[points[-1]]

def strip(name,points,width,height,material,offset=0):
    verts=[]
    for i,p in enumerate(points):
        direction=(points[min(i+1,len(points)-1)]-points[max(i-1,0)]).normalized()
        normal=Vector((-direction.y,direction.x))
        for sign in (-1,1):verts.append(V(*(p+normal*(offset+sign*width/2)),height))
    return mesh(name,verts,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(points)-1)],material)

def kerbs(points,width):
    for sign in (-1,1):
        for i,(p,d) in enumerate(samples(points,.7)):
            if (p-Vector((-492,-393))).length < 9: continue
            # Walkthrough ENTRY pavilion: leave a clear, flush road-to-pavilion opening.
            # The former left-side pavilion opening is closed after the user's side correction.
            # The gate forecourt (photo 20261015_104444) is one wide asphalt apron.
            if (p-Vector(GATE)).length < 34: continue
            n=Vector((-d.y,d.x));q=p+n*(width/2+.13)*sign
            a=V(*(q-d*.34),.33);b=V(*(q+d*.34),.33)
            beam('G9 alternating kerb',a,b,.26,M['yellow' if i%2 else 'black'],.18)

def road(name,coords,width,material,kerb=True):
    points=smooth(coords)
    strip('SITE_GROUND_gate9 '+name,points,width,.238,material)
    if kerb:kerbs(points,width)
    return points

# Closest connected frontage point, derived from the already authored road network.
approach=road('asphalt approach',[(-627.798,-321.451),(-609,-333),(-579,-347),GATE],18,M['asphalt'],False)
# Leave the junction mouth free of a cross-kerb; edges start beyond the main road.
kerbs(approach[9:],18)
strip('G9 worn white lane marking',approach[9:],.13,.247,M['white'],.9)
near_gate=lambda p:(Vector(p)-Vector(GATE)).length<34
for sign in [-1,1]:
    strip('SITE_GROUND_gate9 approach footpath',[p for p in approach[9:] if not near_gate(p)],1.8,.245,M['concrete'],sign*10.1)
    for i,(p,d) in enumerate(samples(approach[12:],1.1)):
        if near_gate(p): continue
        n=Vector((-d.y,d.x));q=p+n*sign*11.2
        beam('G9 white boundary picket',V(*q,.5),V(*q,1.45),.06,M['white'])
    for offset in [.75,1.3]:
        for a,b in zip(approach[12:],approach[13:]):
            if near_gate(a) or near_gate(b): continue
            d=(b-a).normalized();n=Vector((-d.y,d.x))
            beam('G9 white boundary rail',V(*(a+n*sign*11.2),offset),V(*(b+n*sign*11.2),offset),.045,M['white'])
# Wide forecourt in front of both gates and the cabin (photo 20261015_104444).
strip('SITE_GROUND_gate9 forecourt',[Vector(GATE)+Vector(F)*d for d in (-33,-20,-8,0)],44,.2392,M['asphalt'])

collection=collections['03']
inside=road('concrete entry lane',[GATE,(-525,-372),(-509,-384),(-492,-393),(-469,-394),(-408,-394),(-372,-394),(-368,-377),(-367,-350)],12,M['concrete'])
# Existing interior path connection; preserve the office footprint and the halls.
exit_lane=road('office side link',[(-492,-393),(-499,-374),(-505,-350),(-491,-331)],7,M['concrete'])
for p,d in samples(inside,7):
    n=Vector((-d.y,d.x))
    beam('G9 concrete expansion joint',V(*(p-n*5.8),.241),V(*(p+n*5.8),.241),.022,M['joint'],.005)
# Subtle irregular damp patches, observed in photos 1 and 2.
for s,t,rx,ry in [(-540,-365,1.4,.65),(-533,-370,1.1,.5),(-460,-394,1.15,.4),(-455,-395,.65,.48)]:
    verts=[V(s,t,.242)]+[V(s+rx*math.cos(i*math.tau/16)*(1+random.uniform(-.2,.2)),t+ry*math.sin(i*math.tau/16)*(1+random.uniform(-.2,.2)),.242) for i in range(16)]
    mesh('G9 damp patch surface',verts,[(0,i+1,(i+1)%16+1) for i in range(16)],M['wet'])

collection=collections['02']
ga=math.atan2(*(V(*R,0)-V(0,0,0))[1::-1])
# Khaki barred gates as photographed on 2026-10-15 (20261015_104444): a two-leaf
# sliding vehicle gate, five rails, close vertical bars, no arch or lettering.
EVIDENCE='Photo 20261015_104444 (gate from outside); leaf sizes estimated'
def leaf_bars(member,lo,hi,d=0):
    for y in [.38,1.3,2.3,3.3,4.35]:member('G9 sliding leaf horizontal rail',(lo,d,y),(hi,d,y),.11)
    for x in [lo,(lo+hi)/2,hi]:member('G9 sliding leaf vertical frame',(x,d,.38),(x,d,4.4),.12)
    for x in np.arange(lo+.16,hi-.08,.16):member('G9 khaki vertical bar',(x,d,.42),(x,d,4.32),.04)
for side in (-1,1):
    group=bpy.data.objects.new('GATE9_moving_leaf_'+('left' if side<0 else 'right'),None)
    collection.objects.link(group);created.append(group)
    group['slideSign']=side
    def member(name,a,b,w,matl=M['khaki'],depth=None):
        o=beam(name,gate(*a),gate(*b),w,matl,depth);o.parent=group
        return o
    lo,hi=(-7,0) if side<0 else (0,7)
    leaf_bars(member,lo,hi)
    for x in [lo+.4,hi-.4]:
        o=cylinder('G9 gate roller',gate(x,0,.31),.14,.12,M['dark']);o.parent=group
for side in [-1,1]:
    box('G9 gate post',gate(side*7.2,0,2.4),(.3,.3,4.4),M['khaki'])
# Right of the vehicle gate (from outside): the retained dark fence on its red base.
beam('G9 boundary base',gate(7.4,.45,.57),gate(19,.45,.57),.5,M['red'],.65)
for x in np.arange(7.4,19,.2):beam('G9 fixed fence bar',gate(x,.45,.8),gate(x,.45,3.1),.045,M['dark'])
for h in [1.1,2.85]:beam('G9 fixed fence rail',gate(7.4,.45,h),gate(19,.45,h),.065,M['dark'])
# Left of the cabin: a narrower single-leaf khaki gate (closed) with its own posts.
beam('G9 boundary base',gate(-19,.45,.57),gate(-11.6,.45,.57),.5,M['red'],.65)
def fixed(name,a,b,w,matl=M['khaki'],depth=None):return beam(name,gate(*a),gate(*b),w,matl,depth)
leaf_bars(fixed,-18.6,-12.0)
for x in [-18.9,-11.7]:box('G9 gate post',gate(x,0,2.4),(.3,.3,4.4),M['khaki'])
# Boom barriers: one before the small gate, one behind the vehicle gate. Arms are
# separate objects (origin at the hinge) that venue-gate9.ts raises on approach.
def barrier(name,a,d,length,direction):
    box('G9 barrier cabinet',gate(a,d,.55),(.38,.32,.95),M['boomred'],ga)
    box('G9 barrier cabinet top',gate(a,d,1.05),(.42,.36,.08),M['dark'],ga)
    # One striped arm mesh whose vertices are relative to the hinge (its origin).
    origin=gate(a,d,1.12);side=(gate(0,1,0)-gate(0,0,0)).normalized();up=Vector((0,0,1))
    verts=[];faces=[]
    for k in range(int(length)):
        start=(gate(k*direction,0,0)-gate(0,0,0));end=(gate((k+1)*direction,0,0)-gate(0,0,0))
        base=len(verts)
        for p in (start,end):
            for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]:verts.append(p+side*x*.045+up*y*.075)
        faces+= [tuple(base+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]]
    arm=mesh(name,[tuple(v) for v in verts],faces,M['boom'])
    arm.data.materials.append(M['boomred'])
    for p in arm.data.polygons:p.material_index=(p.index//6)%2
    arm.location=origin;arm['hinge']=True
    return arm
barrier('GATE9_barrier_arm_left',-19.3,-3.2,7,1)
barrier('GATE9_barrier_arm_right',7.7,3.6,13,-1)
# Floodlight mast at the right boundary (photo 20261015_104444, far right).
beam('G9 floodlight mast',gate(19.6,-2.2,.3),gate(19.6,-2.2,9.6),.14,M['dark'])
beam('G9 floodlight crossarm',gate(18.9,-2.2,9.5),gate(20.3,-2.2,9.5),.09,M['dark'])
for x in [19.05,20.15]:
    box('G9 floodlight head',gate(x,-2.35,9.45),(.42,.26,.3),M['dark'],ga)
    box('G9 floodlight diffuser',gate(x,-2.52,9.45),(.36,.03,.24),M['flood'],ga)
    LIGHTS.append({'kind':'flood','position':[*gs(x,-2.6),9.4],'aim':[*gs(x,-14),.3]})
# Boundary either side of the entrance (photo 20261015_104444): left, a cream
# plastered wall with black railings on top and a hedge along the road; right,
# the picket fence continues past the mast, then a taller solid wall. The site
# layer's own perimeter wall is clipped within 24 m of the gate, so these run
# from the gate furniture out to 60 m. Heights are estimated.
EVIDENCE='Photo 20261015_104444 (boundary either side of the gate); lengths and heights estimated'
M['plaster']=mat('cream boundary plaster',(.66,.62,.52),.85)
M['greywall']=mat('grey boundary wall',(.36,.35,.32),.85)
def wall_run(a0,a1,height,material,depth=.3,base=.24):
    centre=(a0+a1)/2
    box('G9 boundary wall',gate(centre,.45,base+height/2),(abs(a1-a0),depth,height),material,ga)
wall_run(-60,-19.2,1.5,M['plaster'])
for x in np.arange(-59.8,-19.2,.18):beam('G9 boundary railing bar',gate(x,.45,1.74),gate(x,.45,2.6),.035,M['dark'])
for h in [1.8,2.55]:beam('G9 boundary railing rail',gate(-60,.45,h),gate(-19.2,.45,h),.055,M['dark'])
for x in np.arange(-60,-19,8):beam('G9 boundary railing post',gate(x,.45,1.74),gate(x,.45,2.65),.07,M['dark'])
box('G9 boundary hedge',gate(-39.75,-1.3,.74),(40.5,.9,1.0),M['hedge'],ga)
beam('G9 boundary base',gate(19,.45,.57),gate(27,.45,.57),.5,M['red'],.65)
for x in np.arange(19,27,.2):beam('G9 fixed fence bar',gate(x,.45,.8),gate(x,.45,3.1),.045,M['dark'])
for h in [1.1,2.85]:beam('G9 fixed fence rail',gate(19,.45,h),gate(27,.45,h),.065,M['dark'])
wall_run(27,60,2.8,M['greywall'],.35)
box('G9 boundary wall coping',gate(43.5,.45,3.12),(33,.45,.1),M['plaster'],ga)
EVIDENCE='Photos 1,2,4,5,6; scale and hidden geometry estimated'

# Checking room: user-supplied Gate 9 crop (2026-10-14). Brown ribbed
# cladding, shallow gable, ivory window trim and security grille are observed;
# dimensions and the concealed rear are estimates. Keep it outside the lane.
M['cabin'] = mat('checking room brown cladding', (.17,.065,.042), .88)
M['rib'] = mat('checking room raised battens', (.235,.103,.069), .82)
M['trim'] = mat('checking room ivory frames', (.64,.62,.49), .73)
M['roof'] = mat('checking room charcoal roof', (.047,.045,.034), .83)
# Positive gate axis is the right side when approaching from outside. The
# 2026-10-15 gate photo shows the cabin between the small left gate and the
# vehicle gate, so it now stands left of the vehicle gate (door towards it).
a,d,w,depth = -9.6,0,3.4,3.2
front = d-depth/2
def cabin_box(name,x,y,z,size,material):
    o=box('G9 checking room '+name,gate(a+x,d+y,z),size,material,ga)
    o['evidence']='User checking-room photo, 2026-10-14; dimensions estimated'
    return o
cabin_box('concrete plinth',0,0,.32,(w+.22,depth+.22,.16),M['concrete'])
cabin_box('brown walls',0,0,1.81,(w,depth,2.82),M['cabin'])
# Shallow pitched roof, including solid gable ends and an overhang on all sides.
profile=[(-w/2,3.22),(w/2,3.22),(0,3.77)]
verts=[gate(a+x,y,z) for y in [-depth/2,depth/2] for x,z in profile]
mesh('G9 checking room gable',verts,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],M['cabin'])
for side in [-1,1]:
    x=side*(w/2+.25)
    corners=[(0,-depth/2-.25,3.83),(x,-depth/2-.25,3.20),
             (x,depth/2+.25,3.20),(0,depth/2+.25,3.83)]
    verts=[gate(a+px,py,pz+offset) for offset in [-.09,0] for px,py,pz in corners]
    mesh('G9 checking room pitched roof',verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],M['roof'])
    beam('G9 checking room front roof fascia',gate(a,front-.27,3.79),gate(a+x,front-.27,3.16),.10,M['roof'],.14)
# Fine vertical battens continue onto the gable without filling the windows.
for x in np.arange(-w/2+.08,w/2,.14):
    top=3.77-abs(x)/(w/2)*.55
    cabin_box('front rib',x,front-.018,(.42+top)/2,(.035,.035,top-.42),M['rib'])
for side in [-1,1]:
    for y in np.arange(-depth/2+.06,depth/2,.15):
        cabin_box('side rib',side*(w/2+.018),y,1.81,(.035,.035,2.78),M['rib'])
    cabin_box('corner trim',side*(w/2-.05),front-.055,1.81,(.075,.075,2.84),M['trim'])
# Front service window, recessed dark glass with clearly spaced vertical bars.
wx,wy,ww,wh=-.61,1.99,1.34,1.38
cabin_box('window recess',wx,front-.05,wy,(ww+.16,.07,wh+.16),M['dark'])
cabin_box('window glazing',wx,front-.10,wy,(ww,.035,wh),M['glass'])
for x in [wx-ww/2-.025,wx+ww/2+.025]:
    cabin_box('window jamb',x,front-.135,wy,(.075,.08,wh+.15),M['trim'])
for z in [wy-wh/2-.035,wy+wh/2+.035]:
    cabin_box('window lintel and sill',wx,front-.135,z,(ww+.18,.09,.075),M['trim'])
for x in np.linspace(wx-ww/2+.10,wx+ww/2-.10,9):
    cabin_box('window grille bar',x,front-.19,wy,(.022,.025,wh),M['steel'])
for z in [wy-.42,wy+.42]:
    cabin_box('window grille rail',wx,front-.195,z,(ww,.025,.025),M['steel'])
# Narrow entrance to the right, with a glazed upper panel and metal handle.
cabin_box('door surround',.91,front-.065,1.58,(.99,.09,2.40),M['trim'])
cabin_box('door leaf',.91,front-.12,1.58,(.82,.055,2.24),M['dark'])
cabin_box('door lower panel',.91,front-.155,.96,(.71,.025,.91),M['cabin'])
cabin_box('door glazing',.91,front-.155,2.04,(.68,.025,1.12),M['glass'])
cabin_box('door handle',1.20,front-.22,1.49,(.035,.07,.24),M['steel'])
cabin_box('entry step',.91,front-.30,.31,(1.08,.60,.15),M['concrete'])

# Retain the separate raised lookout and open boom arm.
for a,d,w,depth,height in [(-11,9,2.6,2.6,5.8)]:
    p=gate(a,d,height/2+.24)
    box('G9 red security cabin',p,(w,depth,height),M['red'],ga)
    box('G9 cabin overhanging roof',gate(a,d,height+.32),(w+.55,depth+.55,.18),M['dark'],ga)
    # Recessed, dark observation glazing on approach-facing wall.
    beam('G9 cabin glass',gate(a-w*.37,d-depth/2-.015,height-.65),gate(a+w*.37,d-depth/2-.015,height-.65),.06,M['glass'],1.05)
    for off in [-w*.37,0,w*.37]:beam('G9 cabin mullion',gate(a+off,d-depth/2-.06,height-1.16),gate(a+off,d-depth/2-.06,height-.12),.045,M['steel'])
EVIDENCE='Photos 1,2,4,5,6; scale and hidden geometry estimated'

def jersey(a,d,length=3):
    # Trapezoidal safety divider; black/yellow sections repeat along its length.
    for j in range(int(length/.5)):
        y=d+j*.5
        profile=[(-.45,.24),(.45,.24),(.34,.55),(.18,1.05),(.18,1.35),(-.18,1.35),(-.18,1.05),(-.34,.55)]
        v=[gate(a+x,y+delta,z) for delta in [-.25,.25] for x,z in profile]
        mesh('G9 striped jersey divider',v,[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],M['yellow' if j%2 else 'black'])
jersey(1,-23,5);jersey(1,-47,3)

def cage(a,d):
    for x in [-1.2,1.2]:beam('G9 yellow barricade upright',gate(a+x,d,.45),gate(a+x,d,1.6),.055,M['yellow'])
    for z in [.5,.95,1.6]:beam('G9 yellow barricade rail',gate(a-1.2,d,z),gate(a+1.2,d,z),.055,M['yellow'])
    for x in np.arange(-1.15,1.2,.15):beam('G9 barricade wire mesh',gate(a+x,d,.98),gate(a+x,d,1.55),.009,M['dark'])
    for z in np.arange(1,1.55,.15):beam('G9 barricade wire mesh',gate(a-1.18,d,z),gate(a+1.18,d,z),.009,M['dark'])
    beam('G9 yellow barricade panel',gate(a-1.15,d,.75),gate(a+1.15,d,.75),.06,M['yellow'],.4)
    for x in [-1,1]:
        beam('G9 barricade foot',gate(a+x,d-.38,.35),gate(a+x,d+.38,.35),.05,M['yellow'])
        for off in [-.32,.32]:cylinder('G9 barricade wheel',gate(a+x,d+off,.3),.10,.1,M['dark'])
# The single yellow barricade stands before the cabin, left of the vehicle gate (20261015_104444).
cage(-14,-4.4)
box('G9 pink plastic barrier',gate(-4.2,-15,.81),(2.1,.65,1.12),M['pink'],ga)
for x in [-.65,.65]:box('G9 moulded barrier slot',gate(-4.2+x,-15-.331,1.14),(.32,.012,.15),M['dark'],ga)
beam('G9 lane reader pole',gate(.8,-10,.3),gate(.8,-10,2.15),.075,M['dark'])
box('G9 lane reader housing',gate(.8,-10,2.18),(.28,.22,.18),M['white'],ga)
cylinder('G9 green litter bin',gate(12.3,-1,.79),.32,1.1,M['green'])
box('G9 litter bin opening',gate(12.3,-1.3,1.04),(.3,.04,.17),M['dark'],ga)

collection=collections['04']
def canopy(s,t,length,width,bays,wall=True):
    # Continuous barrel-vault bays, open undersides and slim supports.
    for bay in range(bays):
        start=s+bay*length/bays;end=s+(bay+1)*length/bays
        verts=[]
        for x in [start,end]:
            for k in range(25):
                theta=k*math.pi/24
                verts.append(V(x,t+width/2*math.cos(theta),3.15+1.45*math.sin(theta)))
        o=mesh('G9 cream vaulted canopy fabric',verts,[(k,k+1,k+26,k+25) for k in range(24)],M['cream'])
        o.data.materials[0].use_backface_culling=False
        for x in [start,end]:
            for k in range(24):beam('G9 canopy curved rib',verts[k] if x==start else verts[k+25],verts[k+1] if x==start else verts[k+26],.05,M['white'])
            for sign in [-1,1]:beam('G9 canopy column',V(x,t+sign*width/2,.24),V(x,t+sign*width/2,3.15),.11,M['white'])
    if wall:
        beam('G9 stained canopy plinth wall',V(s,t+width/2,.73),V(s+length,t+width/2,.73),.26,M['wall'],.98)
    strip('SITE_GROUND_gate9 shelter deck',[Vector((s,t)),Vector((s+length,t))],width,.23,M['concrete'])
canopy(-496,-410,45,10,5)
canopy(-414,-412,34,3.8,7,False)
# Dark fence and red piers on the opposite side of the canopy court.
for s in range(-499,-449,5):
    box('G9 shelter fence red pier',V(s,-419,1.6),(.45,.45,2.72),M['red'],math.pi/3)
    for x in np.arange(s+.3,s+4.8,.22):beam('G9 shelter fence picket',V(x,-419,.4),V(x,-419,2.8),.035,M['dark'])
for h in [.7,2.55]:beam('G9 shelter fence rail',V(-499,-419,h),V(-449,-419,h),.055,M['dark'])

collection=collections['05']
# Reusable meshes of actual tapered, folded leaves, with deterministic variation.
def leaf_cluster(name, count, broad=False):
    verts=[];faces=[]
    for j in range(count):
        angle=random.random()*math.tau
        origin=Vector((random.uniform(-.18,.18),random.uniform(-.18,.18),random.uniform(0,.22)))
        length=random.uniform(.5,1.1) if not broad else random.uniform(.15,.3)
        width=length*(.075 if not broad else .33)
        base=len(verts)
        for k in range(5):
            f=k/4;r=length*f*.65;z=length*math.sin(f*2.1)
            for side in [-1,0,1]:
                w=math.sin(math.pi*f)*width*side
                verts.append(origin+Vector((math.cos(angle)*r-math.sin(angle)*w,math.sin(angle)*r+math.cos(angle)*w,z+(.025 if side==0 else 0))))
        for k in range(4):
            for side in range(2):faces.append((base+k*3+side,base+k*3+side+1,base+(k+1)*3+side+1,base+(k+1)*3+side))
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.materials.append(M['leaf'+str(random.randrange(4))]);return data
clumps=[leaf_cluster('G9 strap leaf plant '+str(i),13) for i in range(5)]
def plant(s,t,scale=1):
    o=bpy.data.objects.new('G9 leaf_canopy ground planting',random.choice(clumps));collection.objects.link(o);created.append(o)
    o.location=V(s,t,.31);o.scale=(scale,scale,scale);o.rotation_euler.z=random.random()*math.tau

def planting_edge(points,offset,width):
    strip('G9 planted earth bed',points,width,.28,M['soil'],offset)
    for p,d in samples(points,.72):
        n=Vector((-d.y,d.x))
        for delta in [-width*.28,width*.28]:
            q=p+n*(offset+delta)+Vector((random.uniform(-.17,.17),random.uniform(-.17,.17)))
            plant(*q,random.uniform(.7,1.2))
planting_edge([p for p in inside[19:60] if p.x < -447],-8,3)
planting_edge([p for p in inside[19:60] if p.x > -399],-8,3)
# Office side: the 2026-10-15 arched walkway and drop-off replace the bed between s=-486 and s=-404.
planting_edge([p for p in inside[24:60] if p.x<-486],8,2.5)
planting_edge([p for p in inside[24:60] if p.x>-404],8,2.5)
planting_edge(exit_lane,5.5,2)

# Tree crowns use clustered individual leaves, shared geometry rather than spheres.
def tree_mesh():
    verts=[];faces=[]
    for j in range(850):
        a=random.random()*math.tau;r=math.sqrt(random.random())*2.7
        z=random.uniform(-.8,1.6)*(1-r/4)
        p=Vector((r*math.cos(a),r*math.sin(a),z));size=random.uniform(.16,.33)
        u=Vector((math.cos(a+.5),math.sin(a+.5),random.uniform(-.4,.4)))*size
        v=Vector((-math.sin(a),math.cos(a),random.uniform(-.7,.7)))*size*.48
        idx=len(verts);verts.extend([p-u,p-v,p+Vector((0,0,.05)),p+v,p+u])
        faces.extend([(idx,idx+1,idx+2),(idx,idx+2,idx+3),(idx+2,idx+1,idx+4),(idx+3,idx+2,idx+4)])
    data=bpy.data.meshes.new('G9 shared broadleaf crown');data.from_pydata(verts,[],faces);data.materials.append(M['leaf1']);return data
crown=tree_mesh()
def tree(s,t,h=7):
    cylinder('G9 tree trunk',V(s,t,h/2+.24),.15,h,M['trunk'])
    for j in range(3):
        a=j*math.tau/3
        end=V(s+math.cos(a)*1.7,t+math.sin(a)*1.7,h)
        beam('G9 tree branch',V(s,t,h*.6),end,.09,M['trunk'])
        o=bpy.data.objects.new('G9 leaf_canopy tree',crown);collection.objects.link(o);created.append(o);o.location=end;o.rotation_euler.z=random.random()*math.tau
for p,d in samples(approach[12:-3],13):
    if near_gate(p): continue   # the forecourt is open asphalt up to the boundary walls
    n=Vector((-d.y,d.x))
    for sign in [-1,1]:tree(*(p+n*sign*15),random.uniform(6.2,8.3))
for s,t in [(-512,-401),(-520,-392),(-502,-412),(-505,-362),(-481,-381.5),(-409,-381.5),(-398,-382),(-376,-411)]:tree(s,t,random.uniform(5.5,7))
# Tall broadleaf trees behind the parking fence (video 20261015_104455, right side).
for s in range(-493,-388,14):tree(s,-421.6,random.uniform(7,9))

collection=collections['06']
def lamp(s,t,ds,dt):
    p=V(s,t,.24);q=V(s,t,6.8);tip=V(s+ds,t+dt,7)
    beam('G9 single arm lamp pole',p,q,.095,M['dark']);beam('G9 short lamp arm',q,tip,.11,M['dark'])
    beam('G9 lamp housing',tip,tip+(tip-q).normalized()*.6,.24,M['dark'],.11)
    beam('G9 lamp diffuser',tip-Vector((0,0,.062)),tip+(tip-q).normalized()*.5-Vector((0,0,.062)),.19,M['light'],.02)
    LIGHTS.append({'kind':'lamp','position':[s+ds*1.3,t+dt*1.3,6.85]})
for s in [-491,-466,-441,-416,-382]:lamp(s,-401,0,1)
for p,d in samples(approach[10:],26):
    n=Vector((-d.y,d.x));q=p+n*10.8;lamp(*q,*(-n))
for s,t in [(-451,-394),(-392,-394)]:
    box('G9 drain grate',V(s,t,.247),(1.1,.65,.014),M['dark'],math.pi/3)
    for j in range(8):beam('G9 drain grille',V(s-.5+j*.14,t-.31,.26),V(s-.5+j*.14,t+.31,.26),.035,M['steel'])

# ---------------------------------------------------------------- 2026-10-15 photos and video
BOXF=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
def ridge(name,points,width,z0,z1,material,offset=0):
    # Clipped hedge: a strip with a flat top and two sides.
    verts=[];faces=[]
    for i,p in enumerate(points):
        direction=(points[min(i+1,len(points)-1)]-points[max(i-1,0)]).normalized()
        normal=Vector((-direction.y,direction.x))
        for sign in (-1,1):
            q=p+normal*(offset+sign*width/2)
            verts.append(V(*q,z0));verts.append(V(*q,z1))
    for i in range(len(points)-1):
        b=4*i
        faces+=[(b+1,b+3,b+7,b+5),(b,b+1,b+5,b+4),(b+3,b+2,b+6,b+7)]
    return mesh(name,verts,faces,material)
def kerb_ring(points):
    loop=[Vector(p) for p in points]+[Vector(points[0])]
    for i,(p,d) in enumerate(samples(loop,.7)):
        beam('G9 alternating kerb',V(*(p-d*.34),.33),V(*(p+d*.34),.33),.26,M['yellow' if i%2 else 'black'],.18)
def rounded_rectangle(x0,y0,x1,y1,r,steps=8):
    out=[]
    for cx,cy,start in [(x1-r,y1-r,0),(x0+r,y1-r,90),(x0+r,y0+r,180),(x1-r,y0+r,270)]:
        for k in range(steps+1):
            angle=math.radians(start+k*90/steps)
            out.append((cx+r*math.cos(angle),cy+r*math.sin(angle)))
    return out

def island(name,points):
    kerb_ring(points)
    mesh('G9 planted earth bed '+name,[V(*p,.29) for p in points],[tuple(range(len(points)))],M['soil'])
def sign(name,bl,br,tr,tl,material):
    # Lettered face; corners as the reader sees them (bottom-left first).
    o=mesh(name,[bl,br,tr,tl],[(0,1,2,3)],material)
    uv=o.data.uv_layers.new(name='Lettering')
    for i,p in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=p
    return o
def plant_at(s,t,z,scale):
    o=bpy.data.objects.new('G9 leaf_canopy ground planting',random.choice(clumps));collection.objects.link(o);created.append(o)
    o.location=V(s,t,z);o.scale=(scale,scale,scale);o.rotation_euler.z=random.random()*math.tau
def lamp2(s,t,dx,dt):
    # Twin-arm lamp (night photos 20261015_180718/180722).
    p=V(s,t,.24);q=V(s,t,7.6)
    beam('G9 double arm lamp pole',p,q,.1,M['dark'])
    for sign in (-1,1):
        tip=V(s+dx*sign*1.1,t+dt*sign*1.1,7.75)
        beam('G9 lamp arm',q,tip,.1,M['dark']);beam('G9 lamp housing',tip,tip+(tip-q).normalized()*.55,.26,M['dark'],.1)
        beam('G9 lamp diffuser',tip-Vector((0,0,.058)),tip+(tip-q).normalized()*.45-Vector((0,0,.058)),.2,M['light'],.02)
        LIGHTS.append({'kind':'lamp','position':[s+dx*sign*1.35,t+dt*sign*1.35,7.6]})
def barrel(name,x0,x1,t,half,eave,rise,material,segments=24):
    verts=[]
    for x in (x0,x1):
        for k in range(segments+1):
            th=k*math.pi/segments
            verts.append(V(x,t+half*math.cos(th),eave+rise*math.sin(th)))
    o=mesh(name,verts,[(k,k+1,k+segments+2,k+segments+1) for k in range(segments)],material)
    return o,verts

collection=bpy.data.collections.new('09 Kiosk, hedges and lane furniture (2026-10-15)')
bpy.context.scene.collection.children.link(collection);collections['09']=collection
EVIDENCE='Photo 20261015_104147 (direction kiosk, hydrant boxes, hedges); kiosk 4.2 x 3.2 m estimated'
# Fork island just inside the gate: the lane widens round a sandstone direction kiosk.
strip('SITE_GROUND_gate9 kiosk fork',[Vector(GATE)+Vector(F)*d for d in (18,30,40,52)],24,.2415,M['asphalt'])
island('kiosk',[gs(-2.6,30),gs(2.6,30),gs(2.6,44),gs(-2.6,44)])
KD=37
def kx(name,a,d,z,size,matl):return box('G9 kiosk '+name,gate(a,KD+d,z),size,matl,ga)
kx('plinth',0,0,.39,(4.6,3.6,.2),M['concrete'])
kx('floor slab',0,0,.53,(4.2,3.2,.08),M['sandstone'])
for ax,dy in [(-1.85,-1.35),(1.85,-1.35),(-1.85,1.35),(1.85,1.35)]:kx('corner pier',ax,dy,2.05,(.5,.5,3.1),M['sandstone'])
kx('rear wall',0,1.45,2.05,(4.2,.3,3.1),M['sandstone'])
kx('front sill',0,-1.5,.78,(3.2,.14,.5),M['sandstone'])
kx('front glazing',0,-1.5,2.05,(3.2,.06,2.1),M['kioskglass'])
for side in (-1,1):
    kx('side sill',side*1.55,0,.78,(.14,2.2,.5),M['sandstone'])
    kx('side glazing',side*1.55,0,2.05,(.06,2.2,2.1),M['kioskglass'])
kx('roof slab',0,0,3.72,(4.9,3.9,.24),M['sandstone'])
kx('roof fascia',0,0,3.92,(4.9,3.9,.16),M['dark'])
board=image_material('direction board lettering',SIGNS/'direction-board.png')
kx('sign backing',0,-1.72,2.75,(3.5,.06,1.6),M['blue'])
sign('G9 kiosk direction sign',gate(-1.7,KD-1.76,2.0),gate(1.7,KD-1.76,2.0),gate(1.7,KD-1.76,3.5),gate(-1.7,KD-1.76,3.5),board)
for ax in (-1.9,1.9):kx('cctv camera',ax,-1.95,3.55,(.16,.3,.14),M['white'])
LIGHTS.append({'kind':'kiosk','position':[*gs(0,KD),3.4]})
lamp(*gs(3.6,43.4),*(-Vector(R)))
# Video 00:45–01:00: paired red fire cabinets at the broad shelter end wall.
box('G9 hydrant plinth wall',V(-494.2,-404.6,.55),(3.4,.5,.6),M['wall'],math.pi/3)
for s in (-495,-493.4):box('G9 red hydrant cabinet',V(s,-404.6,1.3),(.9,.45,.9),M['hydrant'],math.pi/3)
# Clipped hedges behind the strappy beds (photos 20261015_104147, 20261015_104447).
ridge('G9 clipped hedge canopy side',[p for p in inside[22:60] if -500<p.x<-452],.8,.3,1.15,M['hedge'],-9.8)
ridge('G9 clipped hedge office side west',[p for p in inside[22:60] if p.x<-486],.8,.3,1.15,M['hedge'],9.8)
ridge('G9 clipped hedge office side east',[p for p in inside[24:60] if -404<p.x<-385],.8,.3,1.15,M['hedge'],9.8)
# Bend island at the lane's turn towards the gate (photo 20261015_104134): strap plants and a lamp.
lamp2(-506,-404,0,1)
for j in range(14):plant_at(-508+random.uniform(0,6),-405+random.uniform(-2,2),.31,random.uniform(.8,1.2))
for s,t,h in [(-488,-410,4.4),(-473,-410,4.4),(-458,-410,4.4)]:LIGHTS.append({'kind':'canopy','position':[s,t,h]})
LIGHTS.append({'kind':'cabin','position':[*gs(-9.6,0),3.0]})

collection=bpy.data.collections.new('10 Fenced parking shelters and cars (2026-10-15)')
bpy.context.scene.collection.children.link(collection);collections['10']=collection
EVIDENCE='Video 20261015_104455 and photo 20261015_104447 (fence, striped parking shelters, cars); spacing estimated'
for s in range(-449,-386,5):
    box('G9 shelter fence red pier',V(s,-419,1.6),(.45,.45,2.72),M['red'],math.pi/3)
    for x in np.arange(s+.3,s+4.8,.22):beam('G9 shelter fence picket',V(x,-419,.4),V(x,-419,2.8),.035,M['dark'])
for h in [.7,2.55]:beam('G9 shelter fence rail',V(-449,-419,h),V(-386,-419,h),.055,M['dark'])
strip('SITE_GROUND_gate9 parking deck',[Vector((-499,-433)),Vector((-385,-433))],22,.2395,M['concrete'])
def shelter(s0,s1,t,width,bay):
    n=int((s1-s0)/bay)
    for i in range(n):
        a,b=s0+i*bay,s0+(i+1)*bay
        o,verts=barrel('G9 parking shelter fabric',a,b,t,width/2,2.9,1.3,M['cream'] if i%2 else M['cream2'],12)
        for k in range(12):beam('G9 shelter rib',verts[k],verts[k+1],.05,M['white'])
        if i==n-1:
            for k in range(12):beam('G9 shelter rib',verts[k+13],verts[k+14],.05,M['white'])
        for sign_ in (-1,1):beam('G9 shelter column',V(a,t+sign_*width/2,.24),V(a,t+sign_*width/2,2.9),.1,M['white'])
    for sign_ in (-1,1):beam('G9 shelter column',V(s1,t+sign_*width/2,.24),V(s1,t+sign_*width/2,2.9),.1,M['white'])
    beam('G9 shelter ridge purlin',V(s0,t,4.2),V(s1,t,4.2),.08,M['white'])
shelter(-497,-386,-428,9,5.55);shelter(-497,-386,-439,9,5.55)
def car(s,t,heading,key):
    # Low-poly hatchback: body, tapered cabin, four wheels. Local x is forward, y is left.
    c,sn=math.cos(heading),math.sin(heading)
    L=lambda x,y,z:V(s+x*c-y*sn,t+x*sn+y*c,z)
    body=[(-2.1,-.85,.35),(2.1,-.85,.35),(2.1,.85,.35),(-2.1,.85,.35),(-2.15,-.88,1.0),(2.05,-.88,.95),(2.05,.88,.95),(-2.15,.88,1.0)]
    mesh('G9 parked car body',[L(*p) for p in body],BOXF,M[key])
    cab=[(-1.5,-.8,1.0),(.9,-.8,1.0),(.9,.8,1.0),(-1.5,.8,1.0),(-1.2,-.72,1.55),(.3,-.72,1.55),(.3,.72,1.55),(-1.2,.72,1.55)]
    mesh('G9 parked car glazing',[L(*p) for p in cab],BOXF,M['car_glass'])
    for x in (-1.35,1.35):
        for y in (-.85,.85):
            verts=[L(x+.32*math.cos(k*math.tau/8),y+w,.33+.32*math.sin(k*math.tau/8)) for w in (-.1,.1) for k in range(8)]
            mesh('G9 car wheel',verts,[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(k,(k+1)%8,(k+1)%8+8,k+8) for k in range(8)],M['dark'])
for row in (-428,-439):
    for line,heading in ((row+2.4,-math.pi/2),(row-2.4,math.pi/2)):
        for s in np.arange(-495.2,-387,2.9):
            if random.random()<.62:car(s,line,heading,random.choice(CARS))

collection=bpy.data.collections.new('11 Office frontage drop-off and walkway (2026-10-15)')
bpy.context.scene.collection.children.link(collection);collections['11']=collection
EVIDENCE='Photos 20261015_104402 (drop-off), 20261015_180717/180724 (ITPO barrier sign, ENTRY pavilion), video (arched walkway); layout estimated'
# Granite sett drop-off along the office frontage (photo 20261015_104402).
rng=np.random.default_rng(15);size=512;pixels=np.ones((size,size,4),dtype=np.float32)
cell=np.indices((size,size))
brightness=rng.uniform(.17,.26,(size//16+1,size//16+1))[(cell[0]//16),(cell[1]//16)]
grout=((cell[0]%16<2)|(cell[1]%16<2))
pixels[:,:,:3]=np.where(grout[:,:,None],.09,brightness[:,:,None]+rng.normal(0,.012,(size,size,1)))
im=bpy.data.images.new('G9 sett grain',width=size,height=size);im.pixels.foreach_set(pixels.ravel())
im.filepath_raw=str(WORK/'sett.png');im.file_format='PNG';im.save();im.pack()
nt=M['sett'].node_tree;tx=nt.nodes.new('ShaderNodeTexImage');tx.image=im
nt.links.new(tx.outputs['Color'],nt.nodes.get('Principled BSDF').inputs['Base Color'])
mesh('SITE_GROUND_gate9 drop-off setts',[V(-445,-394,.2425),V(-404,-394,.2425),V(-404,-383.6,.2425),V(-445,-383.6,.2425)],[(0,1,2,3)],M['sett'])
island('plumeria',rounded_rectangle(-432,-389.2,-416,-384.4,1.65))
def plumeria(s,t):
    cylinder('G9 plumeria trunk',V(s,t,1.4),.11,2.3,M['trunk'],8)
    for j in range(5):
        a=j*math.tau/5+.4;end=V(s+math.cos(a)*1.1,t+math.sin(a)*1.1,3.2)
        beam('G9 plumeria branch',V(s,t,2.3),end,.07,M['trunk'])
        o=bpy.data.objects.new('G9 leaf_canopy plumeria',crown);collection.objects.link(o);created.append(o)
        o.location=end;o.scale=(.42,.42,.3);o.rotation_euler.z=random.random()*math.tau
for s in (-429,-424,-419):plumeria(s,-386.8)
for s in range(-431,-416,3):
    cylinder('G9 terracotta pot',V(s,-384.9,.5),.24,.42,M['pot'],8);plant_at(s,-384.9,.68,.5)
car(-409.5,-390.4,0,'car_white')
def cone(s,t):
    verts=[V(s+.22*math.cos(k*math.tau/8),t+.22*math.sin(k*math.tau/8),.26) for k in range(8)]+[V(s,t,1.0)]
    mesh('G9 traffic cone',verts,[tuple(range(7,-1,-1))]+[(k,(k+1)%8,8) for k in range(8)],M['cone'])
    box('G9 cone base',V(s,t,.25),(.42,.42,.03),M['dark'],math.pi/3)
cones=[(-441,-387.4),(-438.8,-387.9),(-436.6,-388.4)]
for p in cones:cone(*p)
for a,b in zip(cones,cones[1:]):beam('G9 cone chain',V(*a,.8),V(*b,.8),.02,M['dark'])
# Blue board on a post at the drop-off's west end (lettering not legible in the photo, left blank).
beam('G9 blue board post',V(-446.5,-384.2,.24),V(-446.5,-384.2,3.1),.07,M['dark'])
box('G9 blue sign board',V(-446.4,-384.2,2.55),(.05,1.6,.9),M['blue'],math.pi/3)
box('G9 blue board frame',V(-446.42,-384.2,2.55),(.03,1.7,1.0),M['white'],math.pi/3)
# ITPO barrier sign: stainless frame on castors, gold nameplate, blue roundel (20261015_180717).
BS,BT=-452,-384.6
for ds in (-.27,.27):
    for dt in (-1.15,1.15):
        beam('G9 barrier sign upright',V(BS+ds,BT+dt,.3),V(BS+ds,BT+dt,1.0),.03,M['chrome'])
        cylinder('G9 barrier sign castor',V(BS+ds,BT+dt,.25),.05,.1,M['dark'],8)
    for z in (.42,1.0):beam('G9 barrier sign rail',V(BS+ds,BT-1.15,z),V(BS+ds,BT+1.15,z),.03,M['chrome'])
for dt in (-1.15,1.15):beam('G9 barrier sign rail',V(BS-.27,BT+dt,1.0),V(BS+.27,BT+dt,1.0),.03,M['chrome'])
box('G9 barrier sign nameplate back',V(BS-.2,BT,.62),(.04,2.15,.36),M['chrome'],math.pi/3)
plate=image_material('ITPO nameplate lettering',SIGNS/'itpo-nameplate.png')
sign('G9 barrier sign nameplate',V(BS-.225,BT-1.07,.45),V(BS-.225,BT+1.07,.45),V(BS-.225,BT+1.07,.79),V(BS-.225,BT-1.07,.79),plate)
beam('G9 roundel stem',V(BS-.2,BT-.55,1.0),V(BS-.2,BT-.55,1.42),.03,M['chrome'])
ring=[V(BS-.19,BT-.55+.5*math.cos(k*math.tau/24),1.42+.5*math.sin(k*math.tau/24)) for k in range(24)]
mesh('G9 roundel chrome ring',ring,[tuple(range(23,-1,-1))],M['chrome'])
roundel=image_material('ITPO roundel lettering',SIGNS/'itpo-roundel.png')
o=mesh('G9 barrier sign roundel',[V(BS-.21,BT-.55+.46*math.cos(k*math.tau/24),1.42+.46*math.sin(k*math.tau/24)) for k in range(24)],[tuple(range(23,-1,-1))],roundel)
uv=o.data.uv_layers.new(name='Lettering')
for loop in o.data.loops:
    k=loop.vertex_index;uv.data[loop.index].uv=(.5+.5*math.cos(k*math.tau/24),.5+.5*math.sin(k*math.tau/24))
EVIDENCE='Walkthrough 2026-10-16 01:18-01:36; garden-side relationship observed, absolute registration estimated'
# 2026-10-16 walkthrough revision (01:18–01:36): garden-side ENTRY pavilion: four white posts, barrel fabric roof, low ivory wall with the red ENTRY sign.
for x in (-409,-402):
    for t in (-409,-402):beam('G9 pavilion post',V(x,t,.24),V(x,t,3.3),.09,M['white'])
o,verts=barrel('G9 pavilion fabric',-409.3,-401.7,-405.5,3.75,3.3,1.9,M['cream'])
for base in (0,25):
    for k in range(24):beam('G9 pavilion rib',verts[base+k],verts[base+k+1],.06,M['white'])
for k in range(0,25,6):beam('G9 pavilion purlin',verts[k],verts[k+25],.06,M['white'])
box('G9 entry wall',V(-409.6,-405.5,.85),(.35,2.6,1.25),M['ivory'],math.pi/3)
entry=image_material('ENTRY sign lettering',SIGNS/'entry-sign.png',.8)
sign('G9 entry sign',V(-409.8,-406.1,.6),V(-409.8,-404.9,.6),V(-409.8,-404.9,1.2),V(-409.8,-406.1,1.2),entry)
for s in (-407,-404):LIGHTS.append({'kind':'canopy','position':[s,-405.5,3.1]})
# Garden-side arched walkway. Campus registration is estimated; see reference notes.
strip('SITE_GROUND_gate9 walkway deck',[Vector((-445,-406)),Vector((-409,-406))],4.2,.2425,M['concrete'])
arches=list(np.arange(-445,-408.9,6))
for x in arches:
    o,verts=barrel('G9 walkway arch',x-.03,x+.03,-406,2.1,2.7,1.9,M['white'],16)
    for k in range(16):beam('G9 walkway arch tube',verts[k],verts[k+1],.07,M['white'])
    for t in (-408.1,-403.9):beam('G9 walkway post',V(x,t,.24),V(x,t,2.7),.08,M['white'])
for a,b in zip(arches,arches[1:]):
    barrel('G9 walkway fabric',a,b,-406,2.05,2.72,1.86,M['cream'],16)
for k in (0,4,8,12,16):
    th=k*math.pi/16
    beam('G9 walkway purlin',V(-445,-406+2.1*math.cos(th),2.7+1.9*math.sin(th)),V(-409,-406+2.1*math.cos(th),2.7+1.9*math.sin(th)),.06,M['white'])
for s in (-439,-427,-415):LIGHTS.append({'kind':'canopy','position':[s,-406,4.3]})
lamp2(-434,-383.2,0,1);lamp2(-412,-383.2,0,1)
collection=collections['06']
EVIDENCE='Photos 1,2,4,5,6; scale and hidden geometry estimated'

# The only clearly readable permanent lettering in the references (photo 5).
# Windows' Nirmala UI shaped this Devanagari text into a transparent texture.
sign_path=WORK/'itpo-sign.png'
if sign_path.exists():
    signmat=mat('ITPO photographed lettering',(1,1,1))
    nt=signmat.node_tree;bs=nt.nodes.get('Principled BSDF')
    image=bpy.data.images.load(str(sign_path));image.pack()
    image['source']='Authored text: आई टी पी ओ; transcribed from supplied photo 5'
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image
    nt.links.new(tex.outputs['Color'],bs.inputs['Base Color']);nt.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    signmat.surface_render_method='DITHERED'
    o=mesh('G9 photographed ITPO sign',[V(-475.74,-375,23.8),V(-475.74,-357,23.8),V(-475.74,-357,26.1),V(-475.74,-375,26.1)],[(0,1,2,3)],signmat)
    uv=o.data.uv_layers.new(name='Lettering')
    for i,p in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=p
for o in context.objects:
    if o.name=='PHOTO_ITPO office sandstone structure':
        for i,m in enumerate(o.data.materials):
            copy=m.copy();copy.name='G9 ITPO red sandstone'
            copy.diffuse_color=(.28,.105,.072,1)
            copy.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.28,.105,.072,1)
            o.data.materials[i]=copy


# 2026-10-16 walkthrough revision: observed details; measurements are estimates.
collection=bpy.data.collections.new('12 Walkthrough details (2026-10-16)')
bpy.context.scene.collection.children.link(collection);collections['12']=collection
EVIDENCE='WhatsApp walkthrough 2026-10-16; timestamps in work/gate9/references/2026-10-16/README.md. Unsurveyed geometry.'

# 00:09: external stair alongside the elevated lookout, kept outside the entry lane.
stair_a=-13.1
for i in range(20):
    d=5.1+i*.28; h=.24+(i+1)*.18
    box('G9 lookout stair tread',gate(stair_a,d,h-.04),(1.15,.30,.08),M['dark'],ga)
for side in (-.54,.54):
    beam('G9 lookout stair stringer',gate(stair_a+side,5,.25),gate(stair_a+side,10.7,3.9),.075,M['dark'],.16)
    beam('G9 lookout stair handrail',gate(stair_a+side,5,1.2),gate(stair_a+side,10.7,4.85),.045,M['steel'])
    for i in (0,4,8,12,16,19):
        d=5.1+i*.28; h=.24+(i+1)*.18
        beam('G9 lookout stair baluster',gate(stair_a+side,d,h),gate(stair_a+side,d,h+.95),.035,M['steel'])
box('G9 lookout landing',gate(-12,10.65,3.8),(2.8,1.15,.12),M['dark'],ga)
for a in (-13.4,-10.6):
    beam('G9 lookout landing support',gate(a,11,.24),gate(a,11,3.8),.09,M['dark'])
beam('G9 lookout landing rail',gate(-13.4,11.2,4.78),gate(-10.6,11.2,4.78),.045,M['steel'])
for a in (-13.4,-12.7,-12,-11.3,-10.6):beam('G9 lookout landing baluster',gate(a,11.2,3.85),gate(a,11.2,4.78),.035,M['steel'])
for a in (-12.315,-9.685):
    beam('G9 lookout side glazing',gate(a,8.04,5.15),gate(a,9.96,5.15),.04,M['glass'],1.05)
    for d in (8.04,9,9.96):beam('G9 lookout side mullion',gate(a,d,4.62),gate(a,d,5.68),.04,M['steel'])

# 01:18: the office edge is an open lane with a modest hedge, not a covered arcade.
# Reuse the existing office shell and ground-floor piers; add only frontage detail.
M['paving']=mat('office sidewalk warm stone',(.43,.36,.27),.9)
walkedge=rounded_rectangle(-474,-382.5,-437,-379.1,.8)
mesh('SITE_GROUND_gate9 office sidewalk',[V(*p,.28) for p in walkedge],[tuple(range(len(walkedge)))],M['paving'])
kerb_ring(walkedge)
for s in np.arange(-472,-438,1):
    beam('SITE_GROUND_gate9 paving joint',V(s,-382.1,.282),V(s,-379.3,.282),.012,M['joint'],.002)
for t in (-381.6,-380.6,-379.6):
    beam('SITE_GROUND_gate9 paving joint',V(-473.2,t,.282),V(-437.8,t,.282),.012,M['joint'],.002)
ridge('G9 low office foundation hedge',[Vector((-473,-379.35)),Vector((-439,-379.35))],.55,.29,.78,M['hedge'])
for s in (-471,-463,-455,-447):
    cylinder('G9 office terracotta pot',V(s,-381,.49),.26,.42,M['pot'],12)
    plant_at(s,-381,.68,.67)

# Garden strip between the vehicle lane and the corrected garden-side walkway.
garden_edge=[Vector((-445,-401.8)),Vector((-414,-401.8))]
strip('SITE_GROUND_gate9 garden soil',garden_edge,2.6,.27,M['soil'])
ridge('G9 clipped garden edge',garden_edge,.65,.28,.72,M['hedge'])
for s in np.arange(-444.5,-414,.85):plant_at(s,-402.8,.30,.62)

# 01:57–02:21: low lawn/hedge, slender layered trees and a planted turning corner.
M['lawn']=mat('walkthrough lawn',(.12,.22,.045),.98)
garden=rounded_rectangle(-398,-410,-378,-401,2.8)
mesh('SITE_GROUND_gate9 turning garden',[V(*p,.275) for p in garden],[tuple(range(len(garden)))],M['lawn'])
kerb_ring(garden)
ridge('G9 turning garden hedge',[Vector((-395,-402.0)),Vector((-381,-402.0))],.55,.29,.78,M['hedge'])
# Sparse shared leaf layers: only 213 of the existing 850 leaf groups per layer.
# Preserve individual leaf silhouettes without exporting the full broadleaf crown 24 times.
garden_vertices=[];garden_faces=[]
for leaf_index in range(0,850,4):
    base=len(garden_vertices)
    garden_vertices.extend(tuple(crown.vertices[leaf_index*5+k].co) for k in range(5))
    garden_faces.extend(tuple(base+k for k in f) for f in [(0,1,2),(0,2,3),(2,1,4),(3,2,4)])
garden_crown=bpy.data.meshes.new('G9 shared sparse garden foliage')
garden_crown.from_pydata(garden_vertices,[],garden_faces);garden_crown.materials.append(M['leaf1'])
for s in (-395,-391,-387,-383):
    cylinder('G9 slender garden tree trunk',V(s,-407,2.9),.065,5.3,M['trunk'],8)
    for layer in range(6):
        h=1.7+layer*.66; radius=1.15-layer*.15
        for j in range(5):
            angle=j*math.tau/5+layer*.53
            end=V(s+radius*math.cos(angle),-407+radius*math.sin(angle),h+.16)
            beam('G9 slender garden tree branch',V(s,-407,h),end,.023,M['trunk'])
        crown_object=bpy.data.objects.new('G9 leaf_canopy layered garden tree',garden_crown)
        collection.objects.link(crown_object);created.append(crown_object)
        crown_object.location=V(s,-407,h);crown_object.scale=(radius/2.7,radius/2.7,.13)
        crown_object.rotation_euler.z=layer*.53

# Drains and perforated utility panels are flush visual surfaces, not new blockers.
# The cover width and exact map position are estimates from the 02:12 view.
for j in range(9):
    s=-377+j*1.03; t=-388
    box('SITE_GROUND_gate9 perforated access panel',V(s,t,.249),(.99,1.55,.006),M['wall'],math.pi/3)
    for dx in (-.28,0,.28):
        for dy in (-.49,0,.49):
            cylinder('SITE_GROUND_gate9 access panel recess',V(s+dx,t+dy,.253),.027,.001,M['dark'],8)
for s,t in [(-465,-394.5),(-456,-394.5),(-367.8,-388)]:
    box('SITE_GROUND_gate9 recessed drain',V(s,t,.249),(1.0,.72,.006),M['dark'],math.pi/3)
    for j in range(10):
        beam('SITE_GROUND_gate9 flush drain grille',V(s-.45+j*.1,t-.32,.254),V(s-.45+j*.1,t+.32,.254),.025,M['steel'],.004)
for i in range(32):
    s=-472+i*.32
    for t in (-393.1,-392.8):
        cylinder('SITE_GROUND_gate9 old fixing recess',V(s,t,.250),.019,.001,M['joint'],8)

# Flush connector through the kerb opening, kept clear of columns and the low return wall.
strip('SITE_GROUND_gate9 pavilion entry connector',[Vector((-404.5,-399.7)),Vector((-404.5,-406.2))],3.8,.2425,M['concrete'])
# Front edge of the ENTRY pavilion: short return wall, open circulation beyond it.
beam('G9 pavilion low return wall',V(-409.6,-406.8,.85),V(-406.8,-406.8,.85),.23,M['ivory'],1.25)
beam('SITE_GROUND_gate9 pavilion opening threshold',V(-409.7,-404.1,.246),V(-407.3,-401.9,.246),.07,M['white'],.003)
for s in (-408.5,-407.5,-406.5):plant_at(s,-410.1,.30,.8)


# The user corrected the earlier video interpretation with annotated screenshots.
section1 = runpy.run_path(str(ROOT/'scripts/gate9-section1.py'))
section1['correct_section'](globals())
right_corner = runpy.run_path(str(ROOT/'scripts/gate9-right-corner.py'))
right_corner['build'](globals())
office_corner = runpy.run_path(str(ROOT/'scripts/gate9-office-corner.py'))
office_corner['build'](globals())

# Retain the surrounding masses, with the photographed low canopy court clear.
reconcile = runpy.run_path(str(ROOT/'scripts/gate9-context.py'))['reconcile_context']
created.extend(reconcile(ASSETS/'venue-site-detail.glb', collections['08']))

# Match photo viewpoints approximately; no fabricated camera calibration.
def world(p):
    v=V(*p);return [v.x,v.z,-v.y]
views={
    'gate9-approach':{'position':world((-570,-350,1.9)),'target':world((-538,-365,2.5)),'label':'Gate 9 · Approach'},
    'gate9-close':{'position':world((-546.27,-357.05,1.9)),'target':world((-542.692,-363.315,2.3)),'label':'Gate 9 · Metal gate'},
    'gate9-inside':{'position':world((-482,-394,1.9)),'target':world((-420,-394,2.8)),'label':'Gate 9 · Inside the venue'},
    'gate9-canopy':{'position':world((-428,-394,1.9)),'target':world((-481,-399,2.5)),'label':'Gate 9 · Canopy lane'}
}
def gate_world(a,d,h):
    v=gate(a,d,h);return [v.x,v.z,-v.y]
views['gate9-checking-room']={'position':gate_world(-6.4,-10,2.25),
    'target':gate_world(-9.6,0,1.95),'label':'Gate 9 · Checking room'}
views['gate9-kiosk']={'position':gate_world(-5,16,1.9),'target':gate_world(0,37,2.4),'label':'Gate 9 · Direction kiosk'}
views['gate9-dropoff']={'position':world((-455,-392,1.9)),'target':world((-418,-386,2.2)),'label':'Gate 9 · Office drop-off'}
views['gate9-parking']={'position':world((-470,-400,2.0)),'target':world((-440,-432,3)),'label':'Gate 9 · Fenced parking'}
views['gate9-walkway']={'position':world((-408,-406,1.9)),'target':world((-443,-406,2.4)),'label':'Gate 9 · Arched walkway'}
views['gate9-video-office']={'position':world((-478,-394,1.65)),'target':world((-434,-394,2.1)),'label':'Gate 9 · Walkthrough office lane (01:18)'}
views['gate9-video-entry']={'position':world((-418,-397,1.65)),'target':world((-405,-405.5,2.0)),'label':'Gate 9 · Walkthrough ENTRY pavilion (01:30)'}
views['gate9-video-turn']={'position':world((-365,-383,1.65)),'target':world((-388,-403,2.0)),'label':'Gate 9 · Walkthrough garden details'}
views['gate9-video-lookout']={'position':gate_world(-19,4,1.8),'target':gate_world(-12,9,3.2),'label':'Gate 9 · Lookout stairs'}
section1['correct_views'](views, world)
right_corner['views'](views, gate)
office_corner['views'](views, world)
collection=collections['07']
for name,view in views.items():
    cam=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,cam);collection.objects.link(o)
    p=view['position'];t=view['target'];o.location=(p[0],-p[2],p[1]);look=Vector((t[0],-t[2],t[1]))-o.location
    o.rotation_euler=look.to_track_quat('-Z','Y').to_euler();cam.lens=35
bpy.context.scene.camera=bpy.data.objects['gate9-approach']

# Retain editable objects in .blend; merge static export objects by collection/material.
bpy.ops.object.select_all(action='DESELECT')
for o in created:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'gate9-reconstruction.blend'))
for c in collections.values():
    bins={}
    for o in list(c.objects):
        if o.type=='MESH' and not o.parent:
            # Hinged barrier arms stay separate objects: the viewer rotates them.
            category='dynamic '+o.name if o.get('hinge') else 'GROUND' if o.name.startswith('SITE_GROUND') else 'leaf_canopy' if 'leaf_canopy' in o.name else 'static'
            bins.setdefault((o.data.materials[0].name,category),[]).append(o)
    for (material,category),objects in bins.items():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:
            # Joining mutates the active object's mesh. Shared crown/clump data is
            # also used by other collections, so give every member its own copy.
            if o.data.users>1:o.data=o.data.copy()
            o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        objects[0].name=('SITE_GROUND_gate9 ' if category=='GROUND' else 'G9 '+category+' ')+c.name+' '+material
# Gate leaves can be batched individually, never with the fixed fence.
for group in [o for c in collections.values() for o in c.objects if o.type=='EMPTY']:
    children=list(group.children)
    bins={}
    for o in children:bins.setdefault(o.data.materials[0].name,[]).append(o)
    for material,objects in bins.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
        objects[0].name='GATE9_moving_panel '+material
bpy.ops.object.select_all(action='DESELECT')
for c in collections.values():
    if c==collections['07']:continue
    for o in c.objects:
        o.select_set(True)
        if o.type=='MESH' and not o.get('hinge'):
            # Keep millimetre features near the mesh origin. Absolute campus
            # coordinates lose thin bars under the exporter's exponential filter.
            # (Barrier arms already sit at their hinge origin.)
            center=sum((Vector(v) for v in o.bound_box),Vector())/8
            if o.data.users>1:o.data=o.data.copy()
            o.data.transform(Matrix.Translation(-center))
            o.matrix_world=o.matrix_world @ Matrix.Translation(center)
from io_scene_gltf2.io.exp import meshopt
meshopt.EXP_FILTER_BITS=18
bpy.ops.export_scene.gltf(filepath=str(ASSETS/'gate9-detail.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_yup=True,export_meshopt_compression_enable=True)
manifest={'status':'Photo and walkthrough-informed reconstruction (2026-10-16); unsurveyed dimensions and approximate camera registration. Audio transcription is not accepted as survey evidence. Photo 3 provenance unconfirmed; not used for unique geometry.',
          'sourceSha256':source_hash,'gateCenter':world((*GATE,.24)),
          'slideDirection':world((*R,0)), 'slideDistance':7.25,'clearOpeningMetres':14,
          'views':views,'approachConnectionLocal':[-627.798,-321.451],
          'lights':[{'kind':l['kind'],'position':world(l['position']),**({'aim':world(l['aim'])} if 'aim' in l else {})} for l in LIGHTS],
          'barriers':[{'name':'GATE9_barrier_arm_left','hinge':world((*gs(-19.3,-3.2),1.12)),'axis':world((F[0],F[1],0)),'length':7},
                      {'name':'GATE9_barrier_arm_right','hinge':world((*gs(7.7,3.6),1.12)),'axis':world((F[0],F[1],0)),'length':13}],
          'guards':[{'id':'gate9-cabin','position':world((*gs(-7.4,-2.8),.24)),'facing':world((-F[0],-F[1],0))},
                    {'id':'gate9-kiosk','position':world((*gs(4.4,33.5),.24)),'facing':world((-F[0],-F[1],0))},
                    {'id':'gate9-inside','position':world((*gs(3,3.4),.24)),'facing':world((-F[0],-F[1],0))}],
          'photoSet2026_10_15':'work/gate9/references/2026-10-15: ten photographs and video 20261015_104455 (frames extracted every 2 s)',
          'checkingRoomReference':'User-supplied checking-room photograph, 2026-10-14: ribbed brown cabin, shallow gable roof, ivory-framed grilled window and yellow barricade. The 2026-10-15 gate photograph (20261015_104444, taken from outside) shows it between a small left gate and the two-leaf vehicle gate, so it now stands left of the vehicle gate. Footprint 3.4 x 3.2 m and concealed sides are estimated.',
          'photoSequence':[5,2,6,1,4],
          'walkthroughReference':'work/gate9/references/2026-10-16/README.md',
          'walkthroughDurationSeconds':145.112,
          'assumptions':['14 m gate opening and 4.4 m gate height are estimates.',
              'Gate bearing is aligned to the connected outside road; exact surveyed bearing is unavailable.',
              'Small unreadable sign text, concealed rooms and transient traffic are omitted.',
              'Canopy footprints, spacing, road widths and planting positions are inferred from overlapping views.',
              'Office building footprint retained from the existing venue.',
              'User section-one correction supersedes the video interpretation: left is property boundary; canopies/pavilion are on the right. Placement is editable and unsurveyed.',
              'The incorrectly placed Gate 9 parking was removed. Parking belongs near CC; its exact placement awaits the CC section.',
              'The latest right-facing entrance photo supersedes the open near-entry court: red piers, black railings and a low cream shelter now enclose the right side. Heights, lengths and photo pose remain estimated.',
              'Lookout stairs, kerb height, drain-panel spacing and garden tree positions are inferred rather than measured.',
              'Browser inspection was not authorized for this revision; app navigation and mobile appearance remain unverified.',
              'Two inferred northwest context masses are cut back locally at t=-444 m to clear the photographed canopy court; this setback is not surveyed.']}
(ASSETS/'gate9-detail.json').write_text(json.dumps(manifest,indent=2))
(WORK/'reference.json').write_text(json.dumps(manifest,indent=2))
print('GATE9_EXPORT',json.dumps({'bytes':(ASSETS/'gate9-detail.glb').stat().st_size,'sourceUnchanged':hashlib.sha256(source.read_bytes()).hexdigest()==source_hash}))
