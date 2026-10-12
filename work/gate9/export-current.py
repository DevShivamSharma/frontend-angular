import bpy
from mathutils import Vector, Matrix
from pathlib import Path
root=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'gate9-reconstruction.blend'))
collections=[c for c in bpy.data.collections if c.name[:2] in ['01','02','03','04','05','06']]
for c in collections:
    bins={}
    for o in list(c.objects):
        if o.type=='MESH' and not o.parent:
            category='GROUND' if o.name.startswith('SITE_GROUND') else 'leaf_canopy' if 'leaf_canopy' in o.name else 'static'
            bins.setdefault((o.data.materials[0].name,category),[]).append(o)
    for (material,category),objects in bins.items():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
        objects[0].name=('SITE_GROUND_gate9 ' if category=='GROUND' else 'G9 '+category+' ')+c.name+' '+material
for group in [o for c in collections for o in c.objects if o.type=='EMPTY']:
    bins={}
    for o in list(group.children):bins.setdefault(o.data.materials[0].name,[]).append(o)
    for material,objects in bins.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
        objects[0].name='GATE9_moving_panel '+material
bpy.ops.object.select_all(action='DESELECT')
for c in collections:
    for o in c.objects:
        o.select_set(True)
        if o.type=='MESH':
            center=sum((Vector(v) for v in o.bound_box),Vector())/8
            if o.data.users>1:o.data=o.data.copy()
            o.data.transform(Matrix.Translation(-center))
            o.matrix_world=o.matrix_world @ Matrix.Translation(center)
from io_scene_gltf2.io.exp import meshopt
meshopt.EXP_FILTER_BITS=18
bpy.ops.export_scene.gltf(filepath=str(root.parent.parent/'src/assets/venue/gate9-detail.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_meshopt_compression_enable=True)
