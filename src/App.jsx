import { useEffect, useRef, useState } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import './App.css';

function App() {
  const viewerContainerRef = useRef(null);
  const viewerRef = useRef(null);
  const [loadingMsg, setLoadingMsg] = useState("Loading default model...");
  const [isLoaded, setIsLoaded] = useState(false);

  const initViewer = () => {
    if (!viewerContainerRef.current) return null;
    
    // Cleanup old viewer if exists
    if (viewerRef.current) {
      try { viewerRef.current.dispose(); } catch (e) { console.warn(e); }
      viewerContainerRef.current.innerHTML = '';
    }

    const viewer = new GaussianSplats3D.Viewer({
      rootElement: viewerContainerRef.current,
      cameraUp: [0, 1, 0],
      initialCameraPosition: [-1, -1, -1],
      initialCameraLookAt: [0, 0, 0],
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
    });
    
    viewerRef.current = viewer;
    return viewer;
  }

  useEffect(() => {
    const viewer = initViewer();
    if (!viewer) return;

    setLoadingMsg("Loading default gaussians.ply...");
    viewer.addSplatScene('/models/gaussians.ply', {
      splatAlphaCrop: 0,
      showLoadingUI: true,
      format: 2 // SceneFormat.Ply
    })
    .then(() => {
      setLoadingMsg("");
      setIsLoaded(true);
      viewer.start();
    })
    .catch((err) => {
      console.error(err);
      setLoadingMsg("Error loading default file.");
    });

    return () => {
      // cleanup on unmount
    };
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset UI for new file
    setIsLoaded(false);
    setLoadingMsg("Processing your .ply file...");
    
    // Append #.ply to trick the library's internal extension checker
    const url = URL.createObjectURL(file) + '#.ply';

    // Re-init viewer for a fresh start with new file
    const viewer = initViewer();

    if (viewer) {
      viewer.addSplatScene(url, {
        splatAlphaCrop: 0,
        showLoadingUI: true,
        format: 2 // SceneFormat.Ply
      })
      .then(() => {
        setLoadingMsg("");
        setIsLoaded(true);
        viewer.start();
      })
      .catch((err) => {
        console.error(err);
        setLoadingMsg("Error loading file.");
      });
    }
  };

  return (
    <div className="app-container">
      <div ref={viewerContainerRef} className="viewer-container" />
      
      {loadingMsg && (
        <div className="upload-overlay">
          <div className="glass-panel">
            <h1>3D Gaussian Splats</h1>
            <p>{loadingMsg}</p>
            <div className="loader"></div>
          </div>
        </div>
      )}

      {isLoaded && !loadingMsg && (
        <div className="floating-ui">
          <label className="upload-btn small">
            Add your own .ply
            <input 
              type="file" 
              accept=".ply" 
              onChange={handleFileUpload}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export default App;
