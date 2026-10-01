import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Viewer, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

function releaseObject(object) {
  const textures = new Set();
  object?.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials.filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
  });
  textures.forEach((texture) => texture.dispose());
}

export class ModelViewer {
  constructor(container, onContextLost) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#101722');
    this.renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
    this.camera.position.set(3, 2, 3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x72819b, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 6, 3);
    this.scene.add(light);
    this.bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.resize = new ResizeObserver(() => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    });
    this.resize.observe(container);
    this.frame = () => {
      if (this.disposed) return;
      this.controls.update();
      if (this.splats) { this.splats.update(); this.splats.render(); }
      else this.renderer.render(this.scene, this.camera);
      this.animation = requestAnimationFrame(this.frame);
    };
    this.frame();
  }
  async load(url, ext, onProgress) {
    if (ext === 'glb') {
      const gltf = await new GLTFLoader().loadAsync(url, (event) => onProgress(event.total ? event.loaded / event.total * 100 : null, 'Mengunduh model'));
      if (this.disposed) { releaseObject(gltf.scene); return; }
      this.model = gltf.scene;
      this.scene.add(this.model);
      this.bounds.setFromObject(this.model);
      let triangles = 0;
      this.model.traverse((node) => { if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3; });
      this.fit();
      this.controls.saveState();
      return { type: 'Mesh GLB', count: Math.round(triangles), unit: 'segitiga' };
    }
    this.splats = new Viewer({ rootElement: this.container, renderer: this.renderer, camera: this.camera,
      threeScene: new THREE.Scene(), selfDrivenMode: false, useBuiltInControls: false,
      sharedMemoryForWorkers: false, gpuAcceleratedSort: false, sceneRevealMode: 2 });
    const formats = { ply: SceneFormat.Ply, splat: SceneFormat.Splat, ksplat: SceneFormat.KSplat };
    await this.splats.addSplatScene(url, { format: formats[ext], showLoadingUI: false, splatAlphaRemovalThreshold: 1,
      onProgress: (percent, _label, status) => { if (!this.disposed) onProgress(Number.isFinite(percent) ? percent : null, status === 0 ? 'Mengunduh model' : 'Menyiapkan Gaussian Splats'); } });
    if (this.disposed) return;
    const mesh = this.splats.splatMesh, count = mesh.getSplatCount(), center = new THREE.Vector3();
    this.bounds.makeEmpty();
    for (let i = 0; i < count; i++) { mesh.getSplatCenter(i, center); if ([center.x, center.y, center.z].every(Number.isFinite)) this.bounds.expandByPoint(center); }
    this.fit();
    this.controls.saveState();
    return { type: 'Gaussian Splatting', count, unit: 'splat' };
  }
  fit(direction = new THREE.Vector3(1, 0.65, 1)) {
    if (this.bounds.isEmpty()) return;
    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const fov = Math.min(THREE.MathUtils.degToRad(this.camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect));
    const distance = radius / Math.sin(fov / 2) * 1.15;
    this.camera.near = Math.max(radius / 10000, 0.0001);
    this.camera.far = Math.max(distance * 100, 100);
    this.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    this.controls.target.copy(center);
    this.controls.maxDistance = distance * 20;
    this.controls.minDistance = radius * 0.01;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  preset(name) { this.fit(new THREE.Vector3(...({ front: [0, 0, 1], side: [1, 0, 0], top: [0, 1, 0.001], perspective: [1, 0.65, 1] }[name]))); }
  settings(background, quality, rotate) {
    this.renderer.setClearColor(background);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, { low: 1, medium: 1.5, high: 2 }[quality]));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.controls.autoRotate = rotate;
  }
  screenshot() { return new Promise((resolve, reject) => this.renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Screenshot gagal dibuat.')), 'image/png')); }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resize.disconnect();
    this.controls.dispose();
    try { await this.splats?.dispose(); } catch (error) { console.debug('Viewer dibersihkan', error); }
    releaseObject(this.model);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
