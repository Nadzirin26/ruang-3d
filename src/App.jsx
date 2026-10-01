import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelViewer } from './viewer';
import { imageData, validateModel } from './modelFiles';
import './App.css';

const defaultModel = { name: 'gaussians.ply', ext: 'ply', size: 50394257, source: 'Model bawaan', url: '/models/gaussians.ply' };
const demoModel = { name: 'demo-robot.glb', ext: 'glb', source: 'Demo lokal', url: '/models/demo-robot.glb' };
const formatBytes = (bytes) => bytes ? bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—';
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}

export default function App() {
  const container = useRef(null), stage = useRef(null), viewer = useRef(null), sequence = useRef(0), imageSequence = useRef(0), fileSequence = useRef(0);
  const [tab, setTab] = useState('create');
  const [model, setModel] = useState(null), [stats, setStats] = useState(null);
  const [status, setStatus] = useState({ state: 'idle', message: '', progress: null });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [gallery, setGallery] = useState([]), [tasks, setTasks] = useState([]), [health, setHealth] = useState(null);
  const [image, setImage] = useState(null), [sending, setSending] = useState(false), [task, setTask] = useState(null);
  const [background, setBackground] = useState('#e7e7e4'), [quality, setQuality] = useState('medium'), [rotate, setRotate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [capture, setCapture] = useState(null);
  const settings = useRef({ background, quality, rotate });

  const refresh = useCallback(async () => {
    const [models, history, config] = await Promise.all([api('/api/models'), api('/api/tasks'), api('/api/health')]);
    setGallery(models); setTasks(history); setHealth(config);
    return models;
  }, []);

  const loadModel = useCallback(async (entry) => {
    const request = ++sequence.current;
    const previous = viewer.current; viewer.current = null;
    setError(''); setNotice(''); setStats(null); setModel(entry);
    setStatus({ state: 'loading', message: 'Menyiapkan viewer…', progress: null });
    await previous?.dispose();
    if (request !== sequence.current || !container.current) return;
    let instance;
    try {
      instance = new ModelViewer(container.current, (event) => {
        event.preventDefault();
        if (request === sequence.current && !instance?.disposed) { setError('Konteks grafis terputus. Klik Coba lagi atau pilih kualitas Ringan.'); setStatus({ state: 'error', message: '', progress: null }); }
      });
      viewer.current = instance;
      const current = settings.current;
      instance.settings(current.background, current.quality, current.rotate);
      const information = await instance.load(entry.url, entry.ext, (progress, message) => {
        if (request === sequence.current) setStatus({ state: 'loading', progress, message });
      });
      if (request !== sequence.current) return;
      setStats(information); setStatus({ state: 'ready', message: 'Model siap', progress: 100 });
      const address = new URL(location.href);
      if (entry.id) address.searchParams.set('model', entry.id); else address.searchParams.delete('model');
      history.replaceState(null, '', address);
    } catch (cause) {
      if (request !== sequence.current) return;
      setError(`Model gagal dibuka. ${cause.message || 'Periksa format file dan dukungan WebGL browser.'}`);
      setStatus({ state: 'error', message: '', progress: null });
      viewer.current = null; await instance?.dispose();
    }
  }, []);

  useEffect(() => {
    let active = true;
    // This effect synchronizes the viewer with the local server on mount.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh().then((models) => {
      if (!active) return;
      const id = new URL(location.href).searchParams.get('model');
      const entry = models.find((item) => item.id === id);
      if (id && !entry) setNotice('Model pada link tidak ditemukan di galeri komputer ini. Membuka model bawaan.');
      void loadModel(entry || defaultModel);
    }).catch((cause) => { if (active) { setHealth({ configured: false }); void loadModel(defaultModel); setNotice(`Galeri belum tersedia: ${cause.message}`); } });
    // The current viewer is deliberately read at unmount, including later replacements.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { active = false; sequence.current++; const current = viewer.current; viewer.current = null; void current?.dispose(); };
  }, [refresh, loadModel]);

  useEffect(() => {
    settings.current = { background, quality, rotate };
    viewer.current?.settings(background, quality, rotate);
  }, [background, quality, rotate]);
  useEffect(() => () => { if (capture) URL.revokeObjectURL(capture); }, [capture]);

  useEffect(() => {
    if (!task?.id || ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) return;
    let active = true, timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api(`/api/tasks/${task.id}`, { signal: controller.signal });
        if (!active) return;
        if (result.status === 'SUCCEEDED') {
          await refresh();
          if (active && result.model) { await loadModel(result.model); setNotice('Model AI selesai dan tersimpan di galeri.'); }
          if (active) setTask(result);
        } else if (['FAILED', 'CANCELED'].includes(result.status)) {
          setError(result.error || 'Generasi model gagal. Coba foto dengan objek yang lebih jelas.'); await refresh(); if (active) setTask(result);
        } else { setTask(result); timer = setTimeout(poll, 5000); }
      } catch (cause) {
        if (!active) return;
        setError(`Pemeriksaan tugas terhenti: ${cause.message}. Gunakan Lanjutkan / cek hasil di riwayat.`);
        setTask((current) => ({ ...current, paused: true }));
        await refresh().catch(() => {});
      }
    };
    if (!task.paused) void poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [task?.id, task?.paused, task?.status, refresh, loadModel]);

  const openFile = async (file) => {
    if (!file) return;
    const request = ++fileSequence.current;
    try {
      setError(''); setNotice('Memeriksa dan menyimpan model…');
      await validateModel(file);
      if (request !== fileSequence.current) return;
      const entry = await api('/api/models', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
      await refresh(); if (request === fileSequence.current) await loadModel(entry);
    } catch (cause) { if (request === fileSequence.current) { setNotice(''); setError(cause.message); } }
  };
  const selectImage = async (file) => {
    if (!file) return;
    const request = ++imageSequence.current;
    try { const data = await imageData(file); if (request !== imageSequence.current) return; setImage({ name: file.name, size: file.size, data }); setError(''); setTab('create'); }
    catch (cause) { if (request === imageSequence.current) setError(cause.message); }
  };
  const generate = async () => {
    if (!image || sending) return;
    setSending(true); setError('');
    try {
      const result = await api('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: image.data, name: image.name }) });
      setTask(result); await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setSending(false); }
  };
  const action = async (fn) => { try { await fn(); } catch (cause) { setError(cause.message); } };
  const share = async () => {
    const address = new URL(location.href); address.searchParams.set('model', model.id);
    try { await navigator.clipboard.writeText(address.href); setNotice('Link lokal disalin. Link ini membuka galeri pada server komputer yang sama.'); }
    catch { setNotice(`Link lokal: ${address.href}`); }
  };
  const taskBusy = task && !task.paused && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status);
  const ready = status.state === 'ready';
  return (
    <div className="app-shell" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={(event) => {
      event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0];
      if (file?.type.startsWith('image/')) void selectImage(file); else void openFile(file);
    }}>
      <header className="topbar">
        <div className="brand"><span className="brand-icon" aria-hidden="true">3D</span><div><strong>Ruang 3D</strong><small>Model viewer</small></div></div>
        <div className="top-actions"><span className="local-badge">Workspace lokal</span><label className="button primary">Buka model<input type="file" accept=".ply,.splat,.ksplat,.glb" onChange={(event) => { void openFile(event.target.files[0]); event.target.value = ''; }} /></label></div>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <div className="tabs"><button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Gambar → 3D</button><button className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>Galeri ({gallery.length})</button></div>
          {tab === 'create' ? <>
            <div className="section-heading"><h1>Gambar ke model</h1><p>Unggah satu foto objek untuk membuat model 3D melalui Meshy.</p></div>
            <label className="image-picker">
              {image ? <img src={image.data} alt="Gambar sumber model 3D" /> : <div><span className="upload-symbol" aria-hidden="true">+</span><strong>Pilih gambar</strong><small>atau tarik file ke sini</small><small>JPG / PNG · maksimal 10 MB</small></div>}
              <input type="file" accept="image/png,image/jpeg" disabled={sending} onChange={(event) => { void selectImage(event.target.files[0]); event.target.value = ''; }} />
            </label>
            {image && <div className="file-caption"><span>{image.name}</span><small>{formatBytes(image.size)}</small></div>}
            <div className={`service-status ${health?.configured ? 'connected' : ''}`}><span>●</span><div><strong>{health?.configured ? 'Meshy terhubung' : 'API key belum dikonfigurasi'}</strong><small>{health?.configured ? 'Siap membuat model dari foto.' : 'Isi MESHY_API_KEY di .env, lalu restart server.'}</small></div></div>
            <button className="button primary generate" disabled={!image || !health?.configured || sending || taskBusy} onClick={generate}>{sending ? 'Mengirim gambar…' : taskBusy ? 'Model sedang dibuat…' : 'Proses gambar'}</button>
            <p className="fine-print">Saat tombol ditekan, gambar dikirim ke Meshy dan menggunakan kredit akunmu. Bagian yang tidak terlihat pada foto diperkirakan oleh AI.</p>
            {task && <div className="task-card"><strong>{task.name}</strong><span>{task.status}{task.paused ? ' · pemeriksaan dijeda' : ''}</span><progress max="100" value={task.progress || 0} /><small>{task.progress || 0}% · Hasil otomatis masuk galeri.</small>{task.paused && <button className="button" onClick={() => { setError(''); setTask({ ...task, paused: false }); }}>Lanjutkan pemeriksaan</button>}</div>}
            <details className="help"><summary>Tips foto & cara kerja</summary><p>Gunakan satu objek yang terlihat utuh, tajam, dengan latar sederhana. Hasil adalah mesh GLB, bukan Gaussian Splats. Foto tunggal tidak menjamin bentuk sisi belakang akurat.</p><p>Untuk Gaussian Splats, buka file .ply/.splat/.ksplat yang sudah dibuat oleh pipeline rekonstruksi.</p><a href="https://docs.meshy.ai/en/api/image-to-3d" target="_blank" rel="noreferrer">Dokumentasi Meshy ↗</a></details>
          </> : <>
            <div className="section-heading"><h1>Model tersimpan</h1><p>File lokal dan hasil konversi pada komputer ini.</p></div>
            <div className="gallery-list">{gallery.length ? gallery.map((entry) => <button key={entry.id} className={`gallery-item ${model?.id === entry.id ? 'selected' : ''}`} onClick={() => void loadModel(entry)}><span className="model-icon">◇</span><span><strong>{entry.name}</strong><small>{entry.ext.toUpperCase()} · {formatBytes(entry.size)} · {entry.source}</small></span></button>) : <div className="empty-card">Belum ada model. Buka file model atau buat dari gambar.</div>}</div>
            <button className="button wide" onClick={() => action(refresh)}>Refresh galeri</button>
          </>}
          <div className="examples"><span className="eyebrow">Contoh model</span><button className="button" onClick={() => void loadModel(defaultModel)}>Gaussian bawaan</button><button className="button" onClick={() => void loadModel(demoModel)}>Demo mesh 3D</button></div>
          {tasks.length > 0 && <details className="help"><summary>Riwayat AI ({tasks.length})</summary>{tasks.map((item) => <div className="history-item" key={item.id}><strong>{item.name}</strong><small>{item.status}</small><button className="button" onClick={() => { setError(''); setTask({ ...item, status: 'PENDING', paused: false }); }}>Lanjutkan / cek hasil</button></div>)}</details>}
        </aside>
        <section className="stage" ref={stage}>
          <div className="canvas-container" ref={container} />
          <div className="stage-heading"><span className={`status-dot ${ready ? 'ready' : ''}`} /><div><strong>{model?.name || 'Viewer 3D'}</strong><small>{ready ? stats?.type : status.state === 'error' ? 'Model belum siap' : 'Menyiapkan model'}</small></div></div>
          {status.state === 'loading' && <div className="loading-card" role="status"><div className="spinner" /><strong>{status.message}</strong>{status.progress === null ? <progress /> : <><progress max="100" value={status.progress} /><small>{Math.round(status.progress)}% pada tahap ini</small></>}<button className="button" onClick={() => { sequence.current++; const current = viewer.current; viewer.current = null; void current?.dispose(); setStatus({ state: 'idle', message: '', progress: null }); setNotice('Pembukaan model dibatalkan. Pilih model untuk melanjutkan.'); }}>Batalkan loading</button></div>}
          {(error || notice) && <div className={`message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><div>{error && model && status.state === 'error' && <button className="button" onClick={() => void loadModel(model)}>Coba lagi</button>}<button className="dismiss" aria-label="Tutup pesan" onClick={() => { setError(''); setNotice(''); }}>×</button></div></div>}
          <div className="stage-toolbar"><button className="button" disabled={!ready} onClick={() => viewer.current?.fit()}>Fit model</button><button className="button" disabled={!ready} onClick={() => viewer.current?.controls.reset()}>Reset kamera</button><button className="button" disabled={!ready} onClick={() => action(async () => setCapture(URL.createObjectURL(await viewer.current.screenshot())))}>Screenshot</button><button className="button" onClick={() => action(() => document.fullscreenElement ? document.exitFullscreen() : stage.current.requestFullscreen())}>Fullscreen</button></div>
          <div className="control-hint">Drag kiri: putar · Scroll: zoom · Drag kanan: geser</div>
          {dragging && <div className="drop-overlay">Lepaskan gambar atau model di sini</div>}
          {capture && <div className="capture-overlay" role="dialog" aria-modal="true" aria-label="Preview screenshot"><div className="capture-card"><strong>Screenshot siap</strong><img src={capture} alt="Screenshot model 3D" /><div><a className="button primary" href={capture} download="ruang-3d.png">Unduh PNG</a><button className="button" autoFocus onClick={() => setCapture(null)}>Tutup preview</button></div></div></div>}
        </section>
        <aside className="inspector">
          <h2>Tampilan</h2>
          <label className="field">Background<input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /></label>
          <label className="field">Kualitas<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="low">Ringan</option><option value="medium">Seimbang</option><option value="high">Tinggi</option></select></label>
          <label className="toggle"><span>Putar otomatis</span><input type="checkbox" checked={rotate} onChange={(event) => setRotate(event.target.checked)} /></label>
          <p className="field-label">Sudut kamera</p><div className="preset-grid">{[['front', 'Depan'], ['side', 'Samping'], ['top', 'Atas'], ['perspective', 'Perspektif']].map(([key, label]) => <button className="button" disabled={!ready} key={key} onClick={() => viewer.current?.preset(key)}>{label}</button>)}</div>
          <div className="model-info"><span className="eyebrow">INFORMASI MODEL</span><dl><dt>Format</dt><dd>{model?.ext?.toUpperCase() || '—'}</dd><dt>Ukuran</dt><dd>{formatBytes(model?.size)}</dd><dt>{stats?.unit || 'Elemen'}</dt><dd>{stats?.count?.toLocaleString('id-ID') || '—'}</dd><dt>Sumber</dt><dd>{model?.source || '—'}</dd></dl></div>
          {model && <a className="button wide" href={model.url} download={model.name}>Unduh model</a>}
          {model?.id && <button className="button wide" onClick={() => action(share)}>Salin link lokal</button>}
          <p className="fine-print">Galeri dan link lokal bekerja selama server ini berjalan. Untuk dibagikan ke orang lain, unduh model atau screenshot.</p>
        </aside>
      </main>
    </div>
  );
}
