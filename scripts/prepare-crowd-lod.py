"""Bake two mesh detail levels; keep the original Nathan for the player and textures."""
import bpy
from pathlib import Path
root = Path(__file__).resolve().parent.parent
for name, ratio in [('crowd-nathan-near.glb', .24), ('crowd-nathan-lod.glb', .035)]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root / 'src/assets/venue/characters/visitor-nathan.glb'))
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        decimate = obj.modifiers.new('Crowd distance mesh', 'DECIMATE')
        decimate.ratio = ratio
        while obj.modifiers.find(decimate.name) > 0:
            bpy.ops.object.modifier_move_up(modifier=decimate.name)
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        obj.select_set(False)
        print('CROWD_LOD', name, len(obj.data.vertices), len(obj.data.polygons))
    bpy.ops.export_scene.gltf(filepath=str(root / 'src/assets/venue/characters' / name),
        export_format='GLB', export_materials='NONE', export_animations=True,
        export_animation_mode='ACTIONS', export_force_sampling=True, export_skins=True, export_yup=True)
