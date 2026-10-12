import bpy, runpy, json
from pathlib import Path
root = Path(__file__).resolve().parent.parent.parent
work = root/'work/gate9'
bpy.ops.wm.open_mainfile(filepath=str(work/'gate9-reconstruction.blend'))
collection = bpy.data.collections.new('08 Local context reconciliation')
bpy.context.scene.collection.children.link(collection)
reconcile = runpy.run_path(str(root/'scripts/gate9-context.py'))['reconcile_context']
objects = reconcile(root/'src/assets/venue/venue-site-detail.glb', collection)
bpy.ops.wm.save_as_mainfile(filepath=str(work/'gate9-reconstruction.blend'))
for path in [work/'reference.json', root/'src/assets/venue/gate9-detail.json']:
    data = json.loads(path.read_text())
    data['assumptions'].append('Two inferred northwest context masses are cut back locally at t=-444 m to clear the photographed canopy court; this setback is not surveyed.')
    path.write_text(json.dumps(data, indent=2))
print('Retained context objects:', len(objects))
