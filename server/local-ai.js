import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export function createLocalAI(root) {
  const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return {
    async health() {
      try {
        const manifest = JSON.parse(await readFile(join(root, '.local-ai/ready.json'), 'utf8'));
        await Promise.all([access(python), access(join(root, '.local-ai/weights/model.ckpt')), access(join(root, '.local-ai/TripoSR/tsr/system.py')), access(join(root, '.local-ai/rembg/u2netp.onnx'))]);
        return { ready: true, gpu: manifest.gpu, vramGB: manifest.vramGB };
      } catch { return { ready: false, reason: 'Jalankan setup-local.bat untuk memasang TripoSR.' }; }
    },
    run({ input, output, resolution, onProgress }) {
      return new Promise((resolve, reject) => {
        const worker = spawn(python, [join(root, 'ai/generate.py'), '--input', input, '--output', output, '--resolution', String(resolution)], {
          cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });
        const stopOnExit = () => worker.kill();
        process.once('exit', stopOnExit);
        let message = '', stderr = '';
        const timer = setTimeout(() => { message = 'Konversi melewati batas 15 menit. Coba kualitas Ringan.'; worker.kill(); }, 15 * 60 * 1000);
        const lines = createInterface({ input: worker.stdout });
        lines.on('line', (line) => {
          try { const event = JSON.parse(line); if (event.error) message = event.error; else if (typeof event.progress === 'number') onProgress(event.progress, event.message); }
          catch { /* Ignore third-party library notices; only JSON is a progress event. */ }
        });
        worker.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
        worker.on('error', (error) => { process.off('exit', stopOnExit); clearTimeout(timer); lines.close(); reject(new Error(`Python lokal gagal dijalankan: ${error.message}`)); });
        worker.on('close', (code) => {
          process.off('exit', stopOnExit); clearTimeout(timer); lines.close();
          if (code === 0) resolve();
          else { console.error('TripoSR worker failed:', stderr); reject(new Error(message || 'Konversi TripoSR gagal. Periksa instalasi lokal dan memori GPU.')); }
        });
      });
    },
  };
}
