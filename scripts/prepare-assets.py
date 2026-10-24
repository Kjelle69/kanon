"""Copy pinned loader dependencies and extract GLB images without altering the source model."""
from pathlib import Path
import json,struct
root=Path(__file__).resolve().parents[1]
for name in ['loaders/GLTFLoader.js','loaders/FBXLoader.js','utils/BufferGeometryUtils.js','libs/fflate.module.js','curves/NURBSCurve.js','curves/NURBSUtils.js']:
 src=root/'node_modules/three/examples/jsm'/name
 dst=root/'public/vendor/addons'/name;dst.parent.mkdir(parents=True,exist_ok=True)
 dst.write_text(src.read_text().replace("from 'three'", "from '/vendor/three.module.js'"))
for src,dst in [('node_modules/cannon-es/dist/cannon-es.js','public/vendor/cannon-es.js'),('node_modules/cannon-es/LICENSE','public/vendor/CANNON-LICENSE.txt')]:
 (root/dst).write_bytes((root/src).read_bytes())
p=root/'public/assets/models/cannon.glb'
if p.exists():
 data=p.read_bytes();length=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+length]);binary_start=20+length+8
 target=p.parent/'textures';target.mkdir(exist_ok=True)
 for i,im in enumerate(j.get('images',[])):
  if 'bufferView' not in im:continue
  v=j['bufferViews'][im['bufferView']];offset=binary_start+v.get('byteOffset',0)
  ext={'image/png':'png','image/jpeg':'jpg'}[im['mimeType']]
  (target/f'cannon-{i}.{ext}').write_bytes(data[offset:offset+v['byteLength']])
 (p.parent/'image-manifest.json').write_text(json.dumps([f'/assets/models/textures/cannon-{i}.'+{'image/png':'png','image/jpeg':'jpg'}[im['mimeType']] for i,im in enumerate(j.get('images',[]))],indent=2))
