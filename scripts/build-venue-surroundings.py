"""Author the reference surroundings in Blender, exporting only the added layers.
Run: blender --background --python scripts/build-venue-surroundings.py
The existing venue GLB is read-only. No tests are run by this asset builder.
"""
import bpy, json, math, hashlib, os, random, runpy, subprocess
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / 'work/venue-surroundings'
ASSETS = ROOT / 'src/assets/venue'
ref = json.loads((WORK / 'reference.json').read_text())
subprocess.run(['node', str(ROOT / 'scripts/fit-satellite-reference.cjs')], cwd=ROOT, check=True)
subprocess.run(['node', str(ROOT / 'scripts/prepare-venue-roads.cjs')], cwd=ROOT, check=True)
satellite = json.loads((WORK / 'satellite-reference.json').read_text())
road_network = json.loads((WORK / 'roads-prepared.json').read_text())
source = ASSETS / 'IITF_2026_ARCHITECTURAL.glb'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
random.seed(12102026)

# Least-squares affine registration of the supplied aerial to the fixed hall centres.
A = [[0.0]*3 for _ in range(3)]
B = [[0.0]*3 for _ in range(2)]
for anchor in ref['anchors']:
    p = [*anchor['pixel'], 1]
    for i in range(3):
        for j in range(3): A[i][j] += p[i]*p[j]
        for k in range(2): B[k][i] += p[i]*anchor['world'][k]
def solve(b):
    m = [A[i][:]+[b[i]] for i in range(3)]
    for k in range(3):
        d = m[k][k]
        m[k] = [x/d for x in m[k]]
        for i in range(3):
            if i != k:
                t = m[i][k]
                m[i] = [x-t*y for x,y in zip(m[i],m[k])]
    return [r[3] for r in m]
AX, AZ = solve(B[0]), solve(B[1])
def world(p): return (AX[0]*p[0]+AX[1]*p[1]+AX[2], AZ[0]*p[0]+AZ[1]*p[1]+AZ[2])
def V(p, height=0):
    x,z = world(p)
    return Vector((x,-z,height))
def pixel(x,z):
    d=AX[0]*AZ[1]-AX[1]*AZ[0]
    x-=AX[2]; z-=AZ[2]
    return ((x*AZ[1]-z*AX[1])/d,(z*AX[0]-x*AZ[0])/d)
def inside(p, ring):
    hit=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a[1]>p[1]) != (b[1]>p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]: hit=not hit
    return hit

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name != 'Collection' and c.users == 0: bpy.data.collections.remove(c)
bpy.ops.import_scene.gltf(filepath=str(source))
originals=list(bpy.context.scene.objects)
protected=bpy.data.collections.new('00 EXISTING VENUE — protected reference'); bpy.context.scene.collection.children.link(protected)
for o in originals:
    for c in list(o.users_collection): c.objects.unlink(o)
    protected.objects.link(o); o.select_set(False); o.hide_select=True
    # These exterior office/metro placeholders are superseded by the traced layer.
    if o.name.startswith('PHOTO_ADMIN') or o.name == 'SUPREME_COURT_METRO_STN': o.hide_render=True; o.hide_set(True)

phase1=bpy.data.collections.new('01 NEARBY — roads, buildings and metro'); bpy.context.scene.collection.children.link(phase1)
phase2=bpy.data.collections.new('02 PROPERTY — supplemental planting'); bpy.context.scene.collection.children.link(phase2)
collection=phase1
inventory=[]
created=[]
def material(name, color, rough=.85, metal=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF'); s.inputs['Base Color'].default_value=(*color,1); s.inputs['Roughness'].default_value=rough; s.inputs['Metallic'].default_value=metal
    return m
M={
 'ground':material('SITE surrounding planted ground',(.09,.14,.055)),
 'road':material('SITE weathered asphalt',(.14,.16,.16)),
 'walk':material('SITE warm concrete footpaths',(.57,.55,.48)),
 'path':material('SITE pale sandstone walkways',(.72,.66,.55)),
 'white':material('SITE road marking ivory',(.81,.81,.73)),
 'kerb':material('SITE pale kerb stone',(.61,.61,.54)),
 'dark':material('SITE charcoal kerb and metal',(.12,.15,.14),.66),
 'wall':material('SITE nearby warm limestone',(.62,.58,.49)),
 'roof':material('SITE nearby weathered roof',(.47,.46,.40)),
 'red':material('SITE institutional sandstone',(.53,.35,.26)),
 'glass':material('SITE blue-grey recessed glazing',(.16,.24,.28),.32,.35),
 'silver':material('SITE metro silver canopy',(.51,.57,.59),.42,.38),
 'bark':material('SITE tree bark',(.20,.15,.095)),
 'leaves0':material('SITE deep evergreen leaves',(.013,.048,.009)),
 'leaves1':material('SITE midgreen leaves',(.025,.083,.014)),
 'leaves2':material('SITE young green leaves',(.065,.13,.021)),
 'turf':material('SITE clipped groundcover',(.19,.31,.10)),
 'soil':material('SITE planted earth',(.22,.19,.13)),
 'light':material('SITE lamp diffuser',(.8,.77,.63),.4)
}
M['light'].node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value=(.8,.62,.35,1)
M['light'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value=.35

def object_mesh(name, verts, faces, mat):
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); collection.objects.link(o); o.data.materials.append(mat); created.append(o)
    o['phase']=1 if collection==phase1 else 2; o['accuracy']='Reference-aligned; dimensions/detail estimated unless stated'
    return o
def box(name, point, size, mat, angle=0):
    sx,sy,sz=[d/2 for d in size]; c=math.cos(angle); s=math.sin(angle)
    verts=[(point[0]+c*x-s*y,point[1]+s*x+c*y,point[2]+z) for x,y,z in [(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),(-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]]
    return object_mesh(name,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
def beam(name,a,b,width,depth,mat):
    a=Vector(a);b=Vector(b); d=b-a
    return box(name,(a+b)/2,(d.length,width,depth),mat,math.atan2(d.y,d.x))
def prism(name, pts, bottom, top, mat, holes=None):
    # Blender's 2D curve fill keeps actual courtyard openings in the roofs.
    cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='2D'; cu.resolution_u=1; cu.fill_mode='BOTH'; cu.extrude=(top-bottom)/2
    rings=[pts]+(holes or [])
    for ri,ring in enumerate(rings):
        points=[V(p) for p in ring]
        area=sum(a.x*b.y-b.x*a.y for a,b in zip(points,points[1:]+points[:1]))
        if (area>0) != (ri==0): points.reverse()
        spline=cu.splines.new('POLY'); spline.points.add(len(points)-1)
        for q,p in zip(spline.points,points): q.co=(*p[:2],0,1)
        spline.use_cyclic_u=True
    o=bpy.data.objects.new(name,cu); collection.objects.link(o); o.location.z=(top+bottom)/2; o.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o; bpy.ops.object.convert(target='MESH')
    created.append(o); o['phase']=1 if collection==phase1 else 2
    return o
def line_samples(points, spacing):
    carry=0
    for a,b in zip(points,points[1:]):
        d=b-a; length=d.length
        if length<.01: continue
        direction=d/length
        while carry<length:
            yield a+direction*carry,direction
            carry+=spacing
        carry-=length
def strip(name,pts,width,height,mat,offset=0):
    points=[V(p,height) for p in pts]; verts=[]
    for i,p in enumerate(points):
        before=(p-points[max(0,i-1)]).normalized() if i else (points[1]-p).normalized()
        after=(points[min(len(points)-1,i+1)]-p).normalized() if i<len(points)-1 else before
        d=(before+after).normalized(); n=Vector((-d.y,d.x,0)); correction=max(.65,n.dot(Vector((-after.y,after.x,0))))
        verts.extend([p+n*(offset-width/2)/correction,p+n*(offset+width/2)/correction])
    faces=[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(points)-1)]
    return object_mesh(name,verts,faces,mat)

# Organic multi-lobe tree crowns share a small number of meshes in the export.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1)
template=bpy.context.object; sphere=template.data; bpy.data.objects.remove(template,do_unlink=True)
for f in sphere.polygons: f.use_smooth=True
bpy.ops.mesh.primitive_cone_add(vertices=7,radius1=.16,radius2=.1,depth=1)
template=bpy.context.object; trunk_mesh=template.data; bpy.data.objects.remove(template,do_unlink=True)
tree_count=[0,0]; bush_count=[0,0]
def shared(name, mesh, position, scale, mat):
    o=bpy.data.objects.new(name,mesh); collection.objects.link(o); o.location=position; o.scale=scale
    # One material per shared mesh is assigned once below with variants.
    created.append(o);o['phase']=1 if collection==phase1 else 2
    return o
crowns=[]
for k in range(3):
    geo=sphere.copy();geo.materials.clear();geo.materials.append(M['leaves'+str(k)]);crowns.append(geo)
trunk_mesh.materials.append(M['bark'])
def plant(point, radius=3, height=7, bush=False):
    k=0 if collection==phase1 else 1; idx=(bush_count if bush else tree_count)[k]
    prefix=f'SITE_P{k+1}_{"bush" if bush else "tree"}_{idx:04d}'
    if bush: bush_count[k]+=1
    else: tree_count[k]+=1; shared(prefix+'_trunk',trunk_mesh,point+Vector((0,0,height*.33)),(max(1,radius*.7),max(1,radius*.7),height*.66),M['bark'])
    for dx,dy,dh,scale in [(0,0,.68,1),(.47,.17,.54,.72),(-.35,-.24,.56,.76)]:
        o=shared(prefix+'_leaf_canopy',crowns[idx%3],point+Vector((radius*dx,radius*dy,height*dh)),(radius*scale,radius*scale*.92,height*(.34 if not bush else .52)*scale),None)
        o.rotation_euler.z=(idx*.73)%6.28
    return prefix

# Ground follows the tree cover traced on the photo (road-connections.json treeCover); there is no image-sized slab.
tree_cover=[t['points'] for t in road_network['treeCover']]
for i,ring in enumerate(tree_cover):
    prism(f'SITE_nearby_planted_ground_{i:02d}',ring,-.16,-.06,M['ground'])
road_world=[]
R={}
for key in ['road','walk','path','white','kerb','turf','dark','light']:
    R[key]=M[key].copy(); R[key].name='SITE_ROAD '+M[key].name.removeprefix('SITE ')
# Same finish as the rest of the asphalt; the class in the name lets Color → Map shade arterial and local roads.
for key,label in [('roadArterial','arterial'),('roadLocal','local')]:
    R[key]=M['road'].copy(); R[key].name=f'SITE_ROAD weathered asphalt {label}'
# Internal service roads reuse the asphalt material and walkways get one paving
# material, so both batch with the existing road surfaces at runtime.
for key,mat,lo,hi in [('asphalt','road',.025,.035),('asphaltArterial','roadArterial',.025,.035),('asphaltLocal','roadLocal',.025,.035),('footpaths','walk',.03,.11),('kerbs','kerb',.10,.16),('medians','turf',.04,.20),('edgePaint','white',.041,.045),('serviceRoads','road',.03,.05),('walkways','path',.04,.06)]:
    for i,poly in enumerate(road_network['surfaces'][key]):
        prism(f'SITE_ROAD_{key}_{i:03d}',poly[0],lo,hi,R[mat],poly[1:])

def in_junction(p, extra=0):
    return any((p-V(j['p'],p.z)).length < j['radius']+extra for j in road_network['junctions'])

for road in road_network['roads']:
    pts=road['points']; width=road['width']; median=road['median']; name=road['id']
    road_world.append(([V(p) for p in pts],width/2+3))
    points=[V(p,.055) for p in pts]
    if width>=16:
        for p,d in line_samples(points,10):
            if in_junction(p,3):continue
            n=Vector((-d.y,d.x,0))
            for side in [-1,1]:
                center=p+n*side*(median/2+(width-median)/4)
                beam('SITE_'+name+'_lane_marking',center-d*2,center+d*2,.13,.018,R['white'])
    for p,d in line_samples([V(p) for p in pts],48):
        if in_junction(p,4):continue
        n=Vector((-d.y,d.x,0)); p+=n*(width/2+1.7)
        box('SITE_'+name+'_light_pole',p+Vector((0,0,4.1)),(.14,.14,8.2),R['dark'])
        beam('SITE_'+name+'_light_arm',p+Vector((0,0,8.2)),p-n*1.5+Vector((0,0,8.2)),.12,.12,R['dark'])
        box('SITE_'+name+'_light_head',p-n*1.5+Vector((0,0,8.12)),(.9,.36,.13),R['light'],math.atan2(d.y,d.x))
    inventory.append({'id':name,'phase':1,'type':'road','widthMetres':width,'status':'Satellite trace; widths measured off the image, junction detail and road levels estimated'})
for way in road_network['walkways']:
    inventory.append({'id':way['id'],'phase':1,'type':'service-road' if way['type']=='service' else 'walkway','widthMetres':way['width'],'status':'Satellite trace along the walkable centre; width measured off the image'})

building_world=[]
for building in ref['buildings']:
    name=building['id']; pts=building['p']; h=building['h'];holes=building.get('holes',[])
    building_world.append(pts)
    mat=M['red'] if name.startswith('southwest') else M['wall']
    prism('SITE_'+name+'_walls',pts,.04,h,mat,holes)
    prism('SITE_'+name+'_roof',pts,h,h+.22,M['roof'],holes)
    for ring in [pts]+holes:
        vs=[V(p,h+.55) for p in ring]
        for a,b in zip(vs,vs[1:]+vs[:1]):beam('SITE_'+name+'_parapet',a,b,.26,.65,M['wall'])
        for a,b in zip([V(p) for p in ring],[V(p) for p in ring[1:]+ring[:1]]):
            d=b-a;length=d.length
            if length<3:continue
            direction=d/length
            for y in range(3,int(h)-1,3):
                for distance in range(2,int(length)-1,4):
                    p=a+direction*distance+Vector((0,0,y))
                    beam('SITE_'+name+'_recessed_window',p-direction*.9,p+direction*.9,.10,1.25,M['glass'])
    center=sum([V(p,h+.9) for p in pts],Vector())/len(pts)
    if not any(inside(pixel(center.x,-center.y),hole) for hole in holes):
        box('SITE_'+name+'_roof_service',center,(3,2,1.4),M['kerb'])
    inventory.append({'id':name,'phase':1,'type':'building','heightMetres':h,'status':'Visible footprint traced; height and façade estimated'})

# Raised metro viaduct and station. All coordinates follow the visible aerial alignment.
metro=ref['metro']; track=[V(p,metro['deckHeight']) for p in metro['track']]
strip('SITE_metro_viaduct_deck',metro['track'],8,metro['deckHeight'],M['kerb'])
for offset in [-3.8,3.8]:strip('SITE_metro_viaduct_parapet',metro['track'],.4,metro['deckHeight']+.75,M['wall'],offset)
for offset in [-2.25,-.75,.75,2.25]:strip('SITE_metro_steel_rails',metro['track'],.09,metro['deckHeight']+.18,M['dark'],offset)
for p,d in line_samples(track,27):
    box('SITE_metro_viaduct_pier',(p.x,p.y,metro['deckHeight']/2),(1.7,2.4,metro['deckHeight']),M['kerb'],math.atan2(d.y,d.x))
    beam('SITE_metro_pier_cap',p+Vector((-d.y,d.x,0))*4,p-Vector((-d.y,d.x,0))*4,1.8,1.1,M['kerb'])
center=V(metro['center']); direction=(V([metro['center'][0]+metro['axis'][0]*100,metro['center'][1]+metro['axis'][1]*100])-center).normalized();normal=Vector((-direction.y,direction.x,0));length=metro['length'];width=metro['width'];angle=math.atan2(direction.y,direction.x)
box('SITE_Supreme_Court_station_concourse',center+Vector((0,0,6)),(length,width-5,4),M['wall'],angle)
box('SITE_Supreme_Court_station_platform',center+Vector((0,0,9)),(length,width,.7),M['kerb'],angle)
for side in [-1,1]:
    beam('SITE_metro_station_glazing',center-direction*(length/2-1)+normal*side*(width/2-.3)+Vector((0,0,11)),center+direction*(length/2-1)+normal*side*(width/2-.3)+Vector((0,0,11)),.18,2.6,M['glass'])
    for t in range(-int(length/2)+5,int(length/2),9):
        p=center+direction*t+normal*side*(width/2-2)
        box('SITE_metro_station_roof_column',p+Vector((0,0,11.6)),(.24,.24,5),M['silver'],angle)
for a,b in [(-length/2,length/2)]:
    verts=[]
    for x in [a,b]:
        for i in range(19):
            y=-width/2+i*width/18; z=13.2+2.8*(1-(y/(width/2))**2)
            verts.append(center+direction*x+normal*y+Vector((0,0,z)))
    object_mesh('SITE_Supreme_Court_metro_barrel_roof',verts,[(i,i+1,20+i,19+i) for i in range(18)],M['silver'])
for t in range(-int(length/2),int(length/2)+1,6):
    for i in range(12):
        y1=-width/2+i*width/12;y2=y1+width/12
        a=center+direction*t+normal*y1+Vector((0,0,13.25+2.8*(1-(y1/(width/2))**2)))
        b=center+direction*t+normal*y2+Vector((0,0,13.25+2.8*(1-(y2/(width/2))**2)))
        # Roof ribs are actual pitched segments, rather than flat raised lines.
        w=direction*.045
        object_mesh('SITE_metro_roof_rib',[a-w,a+w,b+w,b-w],[(0,1,2,3)],M['kerb'])
for side in [-1,1]:
    stairStart=center+direction*side*(length/2-13)+normal*(width/2+4)
    for i in range(24):
        p=stairStart+normal*i*.38
        box('SITE_metro_access_step',p+Vector((0,0,4.5-i*.17)),(4,.4,.2),M['kerb'],angle)
    box('SITE_metro_access_lift',center+direction*side*(length/2-20)+normal*(width/2+3)+Vector((0,0,5)),(4,4,10),M['glass'],angle)
inventory.append({'id':metro['id'],'phase':1,'type':'metro','status':'Aerial roof and rail alignment; structure heights and access details estimated'})

parking=ref['parking'];prism('SITE_eastern_parking_ground',parking['outline'],.02,.045,M['walk'])
for row in parking['rows']:
    strip('SITE_eastern_parking_planted_row',row,1.5,.14,M['turf'])
    for p,d in line_samples([V(q,.05) for q in row],9):
        plant(p,2.2,5.5)
        n=Vector((-d.y,d.x,0))
        for side in [-1,1]:beam('SITE_parking_bay_marking',p+n*side*2,p+n*side*6,.12,.02,M['white'])

def dist_segment(p,a,b):
    d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared)) if d.length_squared else 0
    return (p-(a+d*t)).length
def clear_outside(p):
    px=pixel(p.x,-p.y)
    if inside(px,ref['propertyBoundary']) or any(inside(px,ring) for ring in building_world):return False
    if inside(px,parking['outline']):return False
    return not any(any(dist_segment(p,a,b)<width+2.5 for a,b in zip(points,points[1:])) for points,width in road_world)

for zi,ring in enumerate(tree_cover):
    minx=min(p[0] for p in ring); maxx=max(p[0] for p in ring); miny=min(p[1] for p in ring);maxy=max(p[1] for p in ring)
    # The ring is photographed canopy, so it is filled at random spacing, without an orchard grid.
    accepted=[]
    for attempt in range(int((maxx-minx)*(maxy-miny)/22)+1):
        q=(random.uniform(minx,maxx),random.uniform(miny,maxy));p=V(q)
        if not inside(q,ring) or not clear_outside(p):continue
        if any((p-a).length<9.5 for a in accepted):continue
        accepted.append(p)
        plant(p,random.uniform(4.4,7.5),random.uniform(6.5,13))

# Inside: only add planting where the original model has a real low lawn surface.
# This rejects hall roofs, paved circulation and door approaches without moving them.
grass_vertices=[];grass_faces=[]
for o in originals:
    if o.type!='MESH':continue
    mats=[m.name.lower() if m else '' for m in o.data.materials]
    if not any(any(k in name for k in ['lawn','turf','grass']) for name in mats):continue
    o.data.calc_loop_triangles()
    for tri in o.data.loop_triangles:
        name=mats[tri.material_index] if tri.material_index<len(mats) else ''
        if not any(k in name for k in ['lawn','turf','grass']):continue
        pts=[o.matrix_world@o.data.vertices[i].co for i in tri.vertices]
        if max(p.z for p in pts)>1 or min(p.z for p in pts)<-.1:continue
        if (pts[1]-pts[0]).cross(pts[2]-pts[0]).z<.001:continue
        start=len(grass_vertices);grass_vertices.extend(pts);grass_faces.append((start,start+1,start+2))
grass=BVHTree.FromPolygons(grass_vertices,grass_faces,all_triangles=True) if grass_faces else None
collection=phase2
for zi,ring in enumerate(ref['insidePlanting']):
    for y in range(int(min(p[1] for p in ring)),int(max(p[1] for p in ring)),8):
        for x in range(int(min(p[0] for p in ring)),int(max(p[0] for p in ring)),8):
            q=(x+random.uniform(-1.3,1.3),y+random.uniform(-1.3,1.3))
            if not inside(q,ring) or not inside(q,ref['propertyBoundary']) or not grass:continue
            p=V(q,2); hit=grass.ray_cast(p,Vector((0,0,-1)),3)[0]
            if hit is None:continue
            # Low clusters stay off the existing routes, with occasional canopy trees.
            plant(hit,random.uniform(.6,1.15),random.uniform(.45,.95),True)
            if (x//8+y//8+zi)%7==0:plant(hit,2.5,6.5)
    inventory.append({'id':f'property-planting-{zi+1:02d}','phase':2,'type':'planting','status':'Visible planting belt constrained to existing lawn mesh; individual bushes inferred'})

# Resolve welded lawn edges, adding a restrained low shrub border only on grass.
# Mesh edges shared by two triangles are interior tessellation, never hedge lines.
edge_counts={};edge_points={}
for face in grass_faces:
    pts=[grass_vertices[i] for i in face]
    for a,b in zip(pts,pts[1:]+pts[:1]):
        ka=tuple(round(v,2) for v in a);kb=tuple(round(v,2) for v in b)
        key=tuple(sorted([ka,kb]));edge_counts[key]=edge_counts.get(key,0)+1;edge_points[key]=(a,b)
border_count=0
for key,count in edge_counts.items():
    if count!=1 or border_count>=280:continue
    a,b=edge_points[key]
    if (b-a).length<5:continue
    for p,d in line_samples([a,b],6):
        n=Vector((-d.y,d.x,0))
        for sign in [-1,1]:
            q=p+n*sign*1.2;px=pixel(q.x,-q.y)
            if not inside(px,ref['propertyBoundary']):continue
            hit=grass.ray_cast(q+Vector((0,0,2)),Vector((0,0,-1)),3)[0]
            if hit is None:continue
            plant(hit,.75,.55,True);border_count+=1;break
inventory.append({'id':'property-lawn-edge-shrubs','phase':2,'type':'planting','count':border_count,'status':'Inferred low planting on existing grass boundaries; individual bushes not surveyed'})

# Lawn, plaza, parking and fountain-pond surfaces traced on the photo, one joined mesh per type.
# The viewer shows them only in Color with the Map scenery, just above the campus ground.
phase3=bpy.data.collections.new('03 MAP — venue ground surfaces'); bpy.context.scene.collection.children.link(phase3)
collection=phase3
S={'lawn':material('SITE_SURFACE lawn',(.21,.45,.10)),'plaza':material('SITE_SURFACE plaza',(.69,.62,.52)),
   'parking':material('SITE_SURFACE parking',(.32,.33,.31)),'water':material('SITE_SURFACE water',(.08,.31,.58),.2)}
for kind,mat in S.items():
    parts=[]
    for surface in road_network['groundSurfaces']:
        if surface['type']!=kind:continue
        o=prism(f'SITE_SURFACE_{kind}_{surface["id"]}',surface['points'],.015,.03,mat); created.remove(o); parts.append(o)
    if not parts:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    if len(parts)>1:bpy.ops.object.join()
    parts[0].name=f'SITE_SURFACE_{kind}'; parts[0]['phase']=3; created.append(parts[0])
    inventory.append({'id':f'ground-surface-{kind}','phase':3,'type':'surface','count':len(parts),'status':'Traced on the z18/z19 photo; shown only in Color → Map'})

# Consolidate static construction by material; retain linked foliage as GLB instances.
# Export the added collections only, leaving every hall/hangar source object untouched.
bpy.ops.object.select_all(action='DESELECT')
for o in originals:o.select_set(False)
for o in created:o.select_set(True)
blend_path=WORK/'bharat-mandapam-surroundings.blend'
bpy.context.scene.world.color=(.22,.26,.3)
bpy.context.scene['reference_status']=ref['status']
bpy.context.scene['property_boundary_source']=ref['source']
bpy.context.preferences.filepaths.save_version=0
runpy.run_path(str(ROOT/'scripts/frame-venue-surroundings.py'))
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.export_scene.gltf(filepath=str(ASSETS/'venue-site-detail.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_yup=True,export_apply=True)
report={'source':ref['source'],'status':ref['status'],'sourceModelSha256':source_hash,'affine':{'x':AX,'z':AZ},'anchorResidualsMetres':{a['id']:round(math.dist(world(a['pixel']),a['world']),3) for a in ref['anchors']},'propertyBoundary':ref['propertyBoundary'],'referenceExtent':[1918,820],
 'mapMask':{'polygons':tree_cover+[b['p'] for b in ref['buildings']]+[parking['outline']],'roads':road_network['roads'],'bounds':road_network['bounds']},
 'roadNetwork':{'source':road_network['source'],'status':road_network['status'],'topology':road_network['topology'],'fadeEnds':[world(e['p']) for e in road_network['topology']['openEnds']]},
 'walkways':{'source':road_network['source'],'status':'Internal service roads and main pedestrian walkways, traced along the walkable centre and joined at junctions. Points are reference-image pixels like mapMask.roads.','paths':road_network['walkways'],'topology':road_network['walkwayTopology']},
 'satelliteReference':{'image':satellite['image'],'imageSize':satellite['imageSize'],'fit':satellite['fit'],'fitAnchors':satellite['fitAnchors'],'excludedAnchors':satellite['excludedAnchors']},
 'trees':{'nearby':tree_count[0],'property':tree_count[1]},'bushes':{'nearby':bush_count[0],'property':bush_count[1]},'features':inventory,'protectedSourceUnchanged':source_hash==hashlib.sha256(source.read_bytes()).hexdigest(),'runtimeReplaces':['SUPREME_COURT_METRO_STN','PHOTO_ADMIN*','PHOTO_PATH campus drives off the satellite (see venue-site-detail.ts SUPERSEDED_DRIVES)'],'blenderFile':'work/venue-surroundings/bharat-mandapam-surroundings.blend'}
(ASSETS/'venue-site-detail.json').write_text(json.dumps(report,indent=2))
print('VENUE_SITE_RESULT '+json.dumps({k:v for k,v in report.items() if k not in ['features','propertyBoundary','mapMask']}))
