import bpy
from pathlib import Path
root=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(root/'gate9-reconstruction.blend'))
scene=bpy.context.scene
scene.camera=bpy.data.objects['gate9-close']
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True
scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.render.filepath=str(root/'blender-gate-preview.png')
bpy.ops.render.render(write_still=True)
