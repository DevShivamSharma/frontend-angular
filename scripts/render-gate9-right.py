"""One bounded offline inspection; does not launch the application or tests."""
import bpy
import sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(root/'work/gate9/gate9-reconstruction.blend'))
scene=bpy.context.scene
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
scene.camera=bpy.data.objects[args[0] if args else 'gate9-entry-right']
scene.camera.data.lens=28
scene.camera.data.clip_end=3000
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world.color=(.52,.60,.64)
scene.view_settings.view_transform='Standard'
scene.view_settings.look='None'
scene.view_settings.exposure=.5
scene.render.resolution_x=1100
scene.render.resolution_y=850
scene.render.resolution_percentage=100
scene.render.filepath=str(root/(args[1] if len(args)>1 else 'work/gate9/references/entry-right/model.png'))
bpy.ops.render.render(write_still=True)
