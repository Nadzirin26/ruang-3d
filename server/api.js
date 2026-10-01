import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateModel, MAX_MODEL_SIZE, MAX_IMAGE_SIZE } from '../src/modelFiles.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function checkedModel(file) {
  try { return await validateModel(file); } catch (error) { throw fail(error.message); }
}
async function body(req, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw fail('File terlalu besar.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export function createApi({ directory, key = '', upstreamFetch = fetch }) {
  const ready = mkdir(directory, { recursive: true });
  let creating = false;
  async function saveJSON(value) {
    const target = join(directory, 'index.json'), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, target);
  }
  async function readIndex() {
    try { return JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { models: [], tasks: [] }; throw error; }
  }
  let mutation = Promise.resolve();
  function changeIndex(fn) {
    const operation = mutation.then(async () => { const index = await readIndex(); const result = await fn(index); await saveJSON(index); return result; });
    mutation = operation.catch(() => {}); return operation;
  }
  async function provider(path = '', options = {}) {
    if (!key) throw fail('MESHY_API_KEY belum diisi. Isi .env lalu restart server.', 503);
    const response = await upstreamFetch(`https://api.meshy.ai/openapi/v1/image-to-3d${path}`, { ...options, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = { 401: 'API key Meshy tidak valid.', 402: 'Kredit Meshy tidak cukup.', 429: 'Batas permintaan Meshy tercapai. Coba lagi nanti.' };
      throw fail(messages[response.status] || `Meshy menolak permintaan (${response.status}). ${String(data.message || '').slice(0, 300)}`, response.status);
    }
    return data;
  }
  const downloading = new Map();
  async function downloadResult(task, url) {
    if (downloading.has(task.id)) return downloading.get(task.id);
    const operation = (async () => {
      const address = new URL(url);
      if (address.protocol !== 'https:' || !(address.hostname === 'assets.meshy.ai' || address.hostname.endsWith('.assets.meshy.ai'))) throw fail('Alamat model dari Meshy tidak dikenali.', 502);
      const response = await upstreamFetch(address, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw fail('Model selesai, tetapi unduhan gagal. Coba cek status lagi.', 502);
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > MAX_MODEL_SIZE) throw fail('Model hasil melebihi batas 250 MB.', 413); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks), file = new Blob([bytes]); file.name = `${task.name}.glb`;
      await checkedModel(file);
      const model = { id: task.id, name: `${task.name}.glb`, ext: 'glb', size: bytes.length, createdAt: new Date().toISOString(), source: 'Meshy AI', url: `/api/models/${task.id}/file` };
      await writeFile(join(directory, `${task.id}.glb`), bytes);
      await changeIndex((index) => { if (!index.models.some((item) => item.id === model.id)) index.models.unshift(model); const saved = index.tasks.find((item) => item.id === task.id); if (saved) saved.modelId = model.id; });
      return model;
    })();
    downloading.set(task.id, operation);
    try { return await operation; } finally { downloading.delete(task.id); }
  }
  return async function api(req, res, next) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/api/')) return next();
    const json = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
    try {
      await ready;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw fail('API hanya tersedia dari localhost.', 403);
      if (req.headers.origin && req.headers.origin !== url.origin) throw fail('Origin tidak diizinkan.', 403);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { configured: Boolean(key), provider: 'Meshy' });
      if (req.method === 'GET' && url.pathname === '/api/models') return json(200, (await readIndex()).models);
      if (req.method === 'POST' && url.pathname === '/api/models') {
        const name = decodeURIComponent(req.headers['x-file-name'] || '').slice(0, 200);
        const bytes = await body(req, MAX_MODEL_SIZE), file = new Blob([bytes]); file.name = name;
        const ext = await checkedModel(file), id = randomUUID();
        const model = { id, name, ext, size: bytes.length, createdAt: new Date().toISOString(), source: 'File lokal', url: `/api/models/${id}/file` };
        await writeFile(join(directory, `${id}.${ext}`), bytes);
        await changeIndex((index) => index.models.unshift(model)); return json(201, model);
      }
      const fileMatch = url.pathname.match(/^\/api\/models\/([a-zA-Z0-9-]+)\/file$/);
      if (req.method === 'GET' && fileMatch) {
        const model = (await readIndex()).models.find((item) => item.id === fileMatch[1]);
        if (!model) throw fail('Model tidak ditemukan.', 404);
        const path = join(directory, `${model.id}.${model.ext}`), info = await stat(path);
        res.setHeader('Content-Type', model.ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream'); res.setHeader('Content-Length', info.size);
        res.setHeader('Content-Disposition', `attachment; filename="model.${model.ext}"`);
        createReadStream(path).on('error', () => res.destroy()).pipe(res); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/tasks') return json(200, (await readIndex()).tasks);
      if (req.method === 'POST' && url.pathname === '/api/tasks') {
        if (creating) throw fail('Permintaan generasi sedang dikirim. Tunggu sebentar.', 409);
        const input = JSON.parse((await body(req, Math.ceil(MAX_IMAGE_SIZE * 1.4) + 2048)).toString());
        const match = typeof input.image === 'string' && input.image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw fail('Gambar harus berupa JPG/PNG.');
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGE_SIZE) throw fail('Gambar maksimal 10 MB.');
        const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (!valid) throw fail('Isi gambar tidak sesuai format.');
        creating = true;
        try {
          const data = await provider('', { method: 'POST', body: JSON.stringify({ image_url: input.image, ai_model: 'latest', should_texture: true, target_formats: ['glb'] }) });
          if (!/^[a-zA-Z0-9-]{1,100}$/.test(data.result)) throw fail('ID tugas Meshy tidak valid.', 502);
          const task = { id: data.result, name: String(input.name || 'model-ai').replace(/\.[^.]+$/, '').slice(0, 150), status: 'PENDING', progress: 0, createdAt: new Date().toISOString() };
          await changeIndex((index) => index.tasks.unshift(task)); return json(201, task);
        } finally { creating = false; }
      }
      const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-zA-Z0-9-]+)$/);
      if (req.method === 'GET' && taskMatch) {
        const index = await readIndex(), task = index.tasks.find((item) => item.id === taskMatch[1]);
        if (!task) throw fail('Tugas tidak ditemukan.', 404);
        if (task.modelId) return json(200, { ...task, status: 'SUCCEEDED', progress: 100, model: index.models.find((item) => item.id === task.modelId) });
        const data = await provider(`/${task.id}`);
        const updated = { ...task, status: data.status, progress: data.progress ?? 0, error: data.task_error?.message || '' };
        await changeIndex((saved) => Object.assign(saved.tasks.find((item) => item.id === task.id), updated));
        if (data.status === 'SUCCEEDED') {
          if (!data.model_urls?.glb) throw fail('Meshy tidak mengembalikan model GLB.', 502);
          updated.model = await downloadResult(task, data.model_urls.glb);
        }
        return json(200, updated);
      }
      json(404, { error: 'Endpoint tidak ditemukan.' });
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 500);
      json(status, { error: status === 500 ? 'Server gagal memproses permintaan. Coba lagi.' : error.message });
      if (status === 500) console.error('Local API:', error.name, error.code || 'request failed');
    }
  };
}
