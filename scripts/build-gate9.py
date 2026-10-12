"""Gate 9 photographic reconstruction. Blender 5.x, no test runner.

The supplied venue is imported only as a locked reference; only Gate 9 detail
is exported. Dimensions are editable estimates, recorded in reference.json.
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
    o['evidence']='Photos 1,2,4,5,6; scale and hidden geometry estimated'
    if material in (M['concrete'],M['asphalt']):
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
            n=Vector((-d.y,d.x));q=p+n*(width/2+.13)*sign
            a=V(*(q-d*.34),.37);b=V(*(q+d*.34),.37)
            beam('G9 alternating kerb',a,b,.26,M['yellow' if i%2 else 'black'],.27)

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
for sign in [-1,1]:
    strip('SITE_GROUND_gate9 approach footpath',approach[9:],1.8,.245,M['concrete'],sign*10.1)
    for i,(p,d) in enumerate(samples(approach[12:],1.1)):
        n=Vector((-d.y,d.x));q=p+n*sign*11.2
        beam('G9 white boundary picket',V(*q,.5),V(*q,1.45),.06,M['white'])
    for offset in [.75,1.3]:
        for a,b in zip(approach[12:],approach[13:]):
            d=(b-a).normalized();n=Vector((-d.y,d.x))
            beam('G9 white boundary rail',V(*(a+n*sign*11.2),offset),V(*(b+n*sign*11.2),offset),.045,M['white'])

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
# Two silver framed sliding leaves, no invented overhead arch or gate lettering.
for side in (-1,1):
    group=bpy.data.objects.new('GATE9_moving_leaf_'+('left' if side<0 else 'right'),None)
    collection.objects.link(group);created.append(group)
    group['slideSign']=side
    pieces=[]
    def member(name,a,b,w,matl=M['steel'],depth=None):
        o=beam(name,gate(*a),gate(*b),w,matl,depth);o.parent=group;pieces.append(o)
        return o
    lo,hi=(-7,0) if side<0 else (0,7)
    for y in [.4,1.15,2.65,4.12,4.42]:member('G9 sliding leaf horizontal frame',(lo,0,y),(hi,0,y),.12)
    for x in [lo,(lo+hi)/2,hi]:member('G9 sliding leaf vertical frame',(x,0,.4),(x,0,4.42),.13)
    for j in range(1,35):
        x=lo+j*.2
        member('G9 silver vertical bar',(x,0,.45),(x,0,4.38),.042)
        # Twisted flat middle-band balusters are clearly visible in photo 2.
        verts=[]
        for k in range(13):
            z=1.2+k*1.4/12;angle=k/12*math.tau
            for dx in [-.065,.065]:verts.append(gate(x+math.cos(angle)*dx,math.sin(angle)*dx,z))
        o=mesh('G9 twisted middle baluster',verts,[(2*k,2*k+1,2*k+3,2*k+2) for k in range(12)],M['steel']);o.parent=group
    for x in [lo+.4,hi-.4]:
        o=cylinder('G9 gate roller',gate(x,0,.31),.14,.12,M['dark']);o.parent=group
for side in [-1,1]:
    box('G9 gate post',gate(side*7.2,0,2.4),(.3,.3,4.4),M['steel'])
    for a,b in [(7.4,19),(-19,-7.4)]:
        if (a>0)!=(side>0):continue
        beam('G9 boundary base',gate(a,.45,.57),gate(b,.45,.57),.5,M['red'],.65)
        for x in np.arange(a,b,.2):beam('G9 fixed fence bar',gate(x,.45,.8),gate(x,.45,3.1),.045,M['dark'])
        for h in [1.1,2.85]:beam('G9 fixed fence rail',gate(a,.45,h),gate(b,.45,h),.065,M['dark'])

# Side cabin, raised lookout and open boom arm, leaving both circulation lanes clear.
for a,d,w,depth,height in [(-10,0,3,3.2,3.2),(-11,9,2.6,2.6,5.8)]:
    p=gate(a,d,height/2+.24)
    box('G9 red security cabin',p,(w,depth,height),M['red'],ga)
    box('G9 cabin overhanging roof',gate(a,d,height+.32),(w+.55,depth+.55,.18),M['dark'],ga)
    # Recessed, dark observation glazing on approach-facing wall.
    beam('G9 cabin glass',gate(a-w*.37,d-depth/2-.015,height-.65),gate(a+w*.37,d-depth/2-.015,height-.65),.06,M['glass'],1.05)
    for off in [-w*.37,0,w*.37]:beam('G9 cabin mullion',gate(a+off,d-depth/2-.06,height-1.16),gate(a+off,d-depth/2-.06,height-.12),.045,M['steel'])
box('G9 boom base',gate(-7.9,-3,.9),(.48,.48,1.3),M['red'],ga)
beam('G9 raised boom arm',gate(-7.9,-3,1.5),gate(-7.9,-2.6,6.2),.08,M['white'],.12)

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
cage(-6.7,-14);cage(-8.9,-3.5)
box('G9 pink plastic barrier',gate(-4.2,-15,.81),(2.1,.65,1.12),M['pink'],ga)
for x in [-.65,.65]:box('G9 moulded barrier slot',gate(-4.2+x,-15-.331,1.14),(.32,.012,.15),M['dark'],ga)
beam('G9 lane reader pole',gate(.8,-10,.3),gate(.8,-10,2.15),.075,M['dark'])
box('G9 lane reader housing',gate(.8,-10,2.18),(.28,.22,.18),M['white'],ga)
cylinder('G9 green litter bin',gate(8.2,-1,.79),.32,1.1,M['green'])
box('G9 litter bin opening',gate(8.2,-1.3,1.04),(.3,.04,.17),M['dark'],ga)

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
planting_edge(inside[19:60],-8,3)
planting_edge(inside[24:60],8,2.5)
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
    n=Vector((-d.y,d.x))
    for sign in [-1,1]:tree(*(p+n*sign*15),random.uniform(6.2,8.3))
for s,t in [(-512,-401),(-520,-392),(-502,-412),(-505,-362),(-481,-384),(-459,-384),(-436,-384),(-409,-384),(-376,-411)]:tree(s,t,random.uniform(5.5,7))

collection=collections['06']
def lamp(s,t,ds,dt):
    p=V(s,t,.24);q=V(s,t,6.8);tip=V(s+ds,t+dt,7)
    beam('G9 single arm lamp pole',p,q,.095,M['dark']);beam('G9 short lamp arm',q,tip,.11,M['dark'])
    beam('G9 lamp housing',tip,tip+(tip-q).normalized()*.6,.24,M['dark'],.11)
    beam('G9 lamp diffuser',tip-Vector((0,0,.062)),tip+(tip-q).normalized()*.5-Vector((0,0,.062)),.19,M['light'],.02)
for s in [-491,-466,-441,-416,-382]:lamp(s,-401,0,1)
for p,d in samples(approach[10:],26):
    n=Vector((-d.y,d.x));q=p+n*10.8;lamp(*q,*(-n))
for s,t in [(-451,-394),(-392,-394)]:
    box('G9 drain grate',V(s,t,.247),(1.1,.65,.014),M['dark'],math.pi/3)
    for j in range(8):beam('G9 drain grille',V(s-.5+j*.14,t-.31,.26),V(s-.5+j*.14,t+.31,.26),.035,M['steel'])

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
            category='GROUND' if o.name.startswith('SITE_GROUND') else 'leaf_canopy' if 'leaf_canopy' in o.name else 'static'
            bins.setdefault((o.data.materials[0].name,category),[]).append(o)
    for (material,category),objects in bins.items():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
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
        if o.type=='MESH':
            # Keep millimetre features near the mesh origin. Absolute campus
            # coordinates lose thin bars under the exporter's exponential filter.
            center=sum((Vector(v) for v in o.bound_box),Vector())/8
            if o.data.users>1:o.data=o.data.copy()
            o.data.transform(Matrix.Translation(-center))
            o.matrix_world=o.matrix_world @ Matrix.Translation(center)
from io_scene_gltf2.io.exp import meshopt
meshopt.EXP_FILTER_BITS=18
bpy.ops.export_scene.gltf(filepath=str(ASSETS/'gate9-detail.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_yup=True,export_meshopt_compression_enable=True)
manifest={'status':'Photo-informed reconstruction; unsurveyed dimensions and camera registration. Photo 3 provenance unconfirmed; not used for unique geometry.',
          'sourceSha256':source_hash,'gateCenter':world((*GATE,.24)),
          'slideDirection':world((*R,0)), 'slideDistance':7.25,'clearOpeningMetres':14,
          'views':views,'approachConnectionLocal':[-627.798,-321.451],
          'photoSequence':[5,2,6,1,4],
          'assumptions':['14 m gate opening and 4.4 m gate height are estimates.',
              'Gate bearing is aligned to the connected outside road; exact surveyed bearing is unavailable.',
              'Small unreadable sign text, concealed rooms and transient traffic are omitted.',
              'Canopy footprints, spacing, road widths and planting positions are inferred from overlapping views.',
              'Office building footprint retained from the existing venue.',
              'Two inferred northwest context masses are cut back locally at t=-444 m to clear the photographed canopy court; this setback is not surveyed.']}
(ASSETS/'gate9-detail.json').write_text(json.dumps(manifest,indent=2))
(WORK/'reference.json').write_text(json.dumps(manifest,indent=2))
print('GATE9_EXPORT',json.dumps({'bytes':(ASSETS/'gate9-detail.glb').stat().st_size,'sourceUnchanged':hashlib.sha256(source.read_bytes()).hexdigest()==source_hash}))
