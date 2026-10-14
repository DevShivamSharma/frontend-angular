"""Prepare the user-supplied Renderpeople Nathan FBX for the visitor viewer.

Usage: blender --background --python scripts/prepare-nathan-avatar.py -- <source-folder>
The original files are read only. Renderpeople licensing still applies to the output.
"""
import bpy
import json
import sys
import tempfile
from pathlib import Path

source = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
output = Path(__file__).resolve().parent.parent / 'src/assets/venue/characters/visitor-nathan.glb'
scratch = output.parents[4] / 'tmp/nathan-export'
scratch.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(scratch)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source / 'rp_nathan_animated_003_walking.fbx'))
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
action = rig.animation_data.action
action.name = 'Walk'
scene.frame_start = int(action.frame_range[0])
scene.frame_end = int(action.frame_range[1])
scene.frame_set(scene.frame_start)

material = bpy.data.materials.new('Nathan clothing and skin')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
shader = nodes.get('Principled BSDF')
shader.inputs['Roughness'].default_value = .85
for suffix, color_space in [('dif', 'sRGB'), ('norm', 'Non-Color')]:
    image = bpy.data.images.load(str(source / 'tex' / f'rp_nathan_animated_003_{suffix}.jpg'))
    image.colorspace_settings.name = color_space
    width, height = image.size
    factor = min(1, 2048 / max(width, height))
    image.scale(round(width * factor), round(height * factor))
    image.pack()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    if suffix == 'dif':
        links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    else:
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .65
        links.new(texture.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
for obj in scene.objects:
    if obj.type == 'MESH':
        obj.data.materials.clear()
        obj.data.materials.append(material)

bpy.ops.export_scene.gltf(
    filepath=str(output), export_format='GLB', export_image_format='JPEG',
    export_jpeg_quality=88, export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_range=True, export_skins=True,
    export_all_influences=False, export_yup=True,
)
print(json.dumps({'output': str(output), 'bytes': output.stat().st_size,
    'frames': [scene.frame_start, scene.frame_end], 'fps': scene.render.fps,
    'bones': len(rig.data.bones)}))
