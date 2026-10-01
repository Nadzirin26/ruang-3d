import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.js';
import { validateModel } from '../src/modelFiles.js';

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ruang3d-test-'));
  const handler = createApi({ directory, ...options });
  const server = createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); await rm(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${server.address().port}`, directory };
}
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=';
test('rejects unsupported PLY and invalid file contents', async () => {
  const file = new Blob(['ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0']); file.name = 'point-cloud.ply';
  await assert.rejects(validateModel(file), /bukan Gaussian/);
  const fake = new Blob(['this is not GLB']); fake.name = 'fake.glb';
  await assert.rejects(validateModel(fake), /GLB tidak valid/);
});
test('local gallery persists uploads, downloads and rejects cross-origin writes', async (t) => {
  const { url, directory } = await setup(t);
  const bytes = await readFile(new URL('../public/models/demo-robot.glb', import.meta.url));
  const uploaded = await fetch(`${url}/api/models`, { method: 'POST', headers: { 'x-file-name': 'robot.glb' }, body: bytes });
  assert.equal(uploaded.status, 201); const model = await uploaded.json();
  assert.equal((await (await fetch(`${url}/api/models`)).json()).length, 1);
  const downloaded = await fetch(`${url}${model.url}`);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  assert.equal(JSON.parse(await readFile(join(directory, 'index.json'))).models[0].id, model.id);
  const denied = await fetch(`${url}/api/models`, { method: 'POST', headers: { origin: 'https://other.example', 'x-file-name': 'robot.glb' }, body: bytes });
  assert.equal(denied.status, 403);
  assert.equal((await fetch(`${url}/api/models`, { method: 'POST', headers: { 'x-file-name': 'bad.glb' }, body: 'invalid' })).status, 400);
});
test('missing key reports actionable error and never calls provider', async (t) => {
  const { url } = await setup(t, { upstreamFetch: () => { throw new Error('Should not be called'); } });
  assert.equal((await (await fetch(`${url}/api/health`)).json()).configured, false);
  const response = await fetch(`${url}/api/tasks`, { method: 'POST', body: JSON.stringify({ image }) });
  assert.equal(response.status, 503); assert.match((await response.json()).error, /MESHY_API_KEY/);
});
test('image-to-3D task uses server key, saves GLB and recovers from provider failure', async (t) => {
  const bytes = await readFile(new URL('../public/models/demo-robot.glb', import.meta.url));
  let polls = 0, downloads = 0;
  const { url } = await setup(t, { key: 'test-secret', upstreamFetch: async (address, options) => {
    if (String(address).startsWith('https://assets.meshy.ai/')) { downloads++; return new Response(bytes); }
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    if (options.method === 'POST') { const payload = JSON.parse(options.body); assert.equal(payload.image_url, image); assert.deepEqual(payload.target_formats, ['glb']); return Response.json({ result: 'task-123' }); }
    if (++polls === 1) return Response.json({ message: 'rate limited' }, { status: 429 });
    return Response.json({ status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://assets.meshy.ai/test.glb' } });
  } });
  const created = await fetch(`${url}/api/tasks`, { method: 'POST', body: JSON.stringify({ name: 'photo.png', image }) });
  assert.equal(created.status, 201); const task = await created.json();
  assert.equal((await fetch(`${url}/api/tasks/${task.id}`)).status, 429);
  const done = await (await fetch(`${url}/api/tasks/${task.id}`)).json();
  assert.equal(done.status, 'SUCCEEDED'); assert.equal(done.model.ext, 'glb');
  assert.equal((await (await fetch(`${url}/api/models`)).json())[0].source, 'Meshy AI');
  await fetch(`${url}/api/tasks/${task.id}`); assert.equal(downloads, 1);
  assert.equal(JSON.stringify(done).includes('test-secret'), false);
});
