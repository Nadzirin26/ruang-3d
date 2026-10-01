import { BoxGeometry, SphereGeometry, CylinderGeometry } from 'three';
import { writeFile } from 'node:fs/promises';

// Small, self-contained GLB to exercise the mesh viewer without an API key.
const json = { asset: { version: '2.0', generator: 'Ruang 3D demo' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], materials: [
  { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.8, 0.65, 1], metallicFactor: 0.2, roughnessFactor: 0.4 } },
  { pbrMetallicRoughness: { baseColorFactor: [0.08, 0.12, 0.2, 1], metallicFactor: 0.3, roughnessFactor: 0.35 } },
  { pbrMetallicRoughness: { baseColorFactor: [1, 0.75, 0.3, 1], metallicFactor: 0.1, roughnessFactor: 0.5 } },
] };
const chunks = []; let offset = 0;
function accessor(array, type, componentType, target, range) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(bytes); offset += bytes.length;
  const padding = (4 - offset % 4) % 4; chunks.push(Buffer.alloc(padding)); offset += padding;
  const id = json.accessors.length;
  json.accessors.push({ bufferView: view, componentType, count: array.length / (type === 'VEC3' ? 3 : 1), type, ...range });
  return id;
}
function part(geometry, translation, material) {
  geometry.computeBoundingBox();
  const position = accessor(geometry.attributes.position.array, 'VEC3', 5126, 34962, { min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray() });
  const normal = accessor(geometry.attributes.normal.array, 'VEC3', 5126, 34962);
  const indices = accessor(geometry.index.array, 'SCALAR', geometry.index.array instanceof Uint16Array ? 5123 : 5125, 34963);
  json.scenes[0].nodes.push(json.nodes.length);
  json.nodes.push({ mesh: json.meshes.length, translation });
  json.meshes.push({ primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material }] });
  geometry.dispose();
}
part(new BoxGeometry(1.2, 1.35, 0.65), [0, 1.4, 0], 0);
part(new BoxGeometry(1.05, 0.8, 0.75), [0, 2.6, 0], 0);
part(new BoxGeometry(0.8, 0.32, 0.05), [0, 2.65, 0.4], 1);
for (const x of [-0.25, 0.25]) part(new SphereGeometry(0.09, 16, 12), [x, 2.65, 0.45], 2);
for (const x of [-0.85, 0.85]) part(new CylinderGeometry(0.18, 0.18, 1, 16), [x, 1.45, 0], 1);
for (const x of [-0.33, 0.33]) { part(new CylinderGeometry(0.18, 0.18, 0.65, 16), [x, 0.4, 0], 1); part(new BoxGeometry(0.4, 0.16, 0.65), [x, 0.08, 0.13], 2); }
part(new CylinderGeometry(0.04, 0.04, 0.35, 12), [0, 3.16, 0], 1);
part(new SphereGeometry(0.11, 16, 12), [0, 3.37, 0], 2);
json.buffers[0].byteLength = offset;
const text = Buffer.from(JSON.stringify(json)), paddedText = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
const binary = Buffer.concat(chunks), header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + paddedText.length + 8 + binary.length, 8);
jsonHeader.writeUInt32LE(paddedText.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
await writeFile(new URL('../public/models/demo-robot.glb', import.meta.url), Buffer.concat([header, jsonHeader, paddedText, binHeader, binary]));
console.log('Demo GLB dibuat.');
