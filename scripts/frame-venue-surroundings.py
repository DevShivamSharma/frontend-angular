"""Set the editable Blender deliverable's saved aerial view and lighting."""
import bpy
from mathutils import Vector

target=Vector((-50,-30,0))
camera_data=bpy.data.cameras.new('Aerial reference camera')
camera=bpy.data.objects.new('Aerial reference camera',camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location=(150,-1120,1230)
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.type='ORTHO';camera_data.ortho_scale=1950;camera_data.clip_end=12000
bpy.context.scene.camera=camera
sun_data=bpy.data.lights.new('Late morning sun','SUN');sun_data.energy=2.5;sun_data.angle=.12
sun=bpy.data.objects.new('Late morning sun',sun_data);bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler=(.45,-.55,-.55)
bpy.context.scene.render.engine='CYCLES'
bpy.context.scene.cycles.samples=32
bpy.context.scene.render.resolution_x=1920;bpy.context.scene.render.resolution_y=1080;bpy.context.scene.render.resolution_percentage=100
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.shading.type='SOLID';space.shading.color_type='MATERIAL'
            space.region_3d.view_location=target
            space.region_3d.view_distance=1700
            space.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
            space.clip_end=12000
if bpy.data.filepath:
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
