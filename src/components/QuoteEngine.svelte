<script lang="ts">
  import { config } from '../config';
  import { onMount } from 'svelte';
  import Dropdown from './Dropdown.svelte';

  // Environment variables for currency
  const currencySymbol = import.meta.env.PUBLIC_CURRENCY_SYMBOL || '$';
  const currencyCode = import.meta.env.PUBLIC_CURRENCY_CODE || 'USD';

  // Svelte 5 Runes for state management
  let files = $state<{ file: File; volume: number; area: number; meshUuid: string; colorId: string }[]>([]);
  let isDragging = $state(false);
  let isProcessing = $state(false);
  let canvasContainer = $state<HTMLElement | null>(null);
  
  let selectedMaterialId = $state(config.materials[0].id);
  let selectedColorId = $state(config.colors[0].id);
  let selectedQualityId = $state(config.qualities[2].id); // Default to 0.4mm
  let infillPercent = $state(20);
  let quantity = $state(1);

  // Customer Details
  let customerName = $state('');
  let customerEmail = $state('');
  let isSubmitting = $state(false);
  let submitSuccess = $state(false);
  let submitError = $state('');
  
  let showGridAndFloor = $state(true);
  let showBuildVolume = $state(true);
  let isLightMode = $state(true);
  let selectedFileForRotation = $state<string | null>(null);
  // Map of meshUuid → warning message (empty string = fits fine)
  let bedWarnings = $state<Map<string, string>>(new Map());

  // Derivations for selected configs
  let material = $derived(config.materials.find(m => m.id === selectedMaterialId)!);
  let color = $derived(config.colors.find(c => c.id === selectedColorId)!);
  let quality = $derived(config.qualities.find(q => q.id === selectedQualityId)!);

  // Derived Calculations
  let THREE: any = null;
  let scene: any, camera: any, renderer: any, controls: any;

  // Derived Calculations
  let totalSolidVolume = $derived(files.reduce((sum, f) => sum + f.volume, 0));
  let totalSurfaceArea = $derived(files.reduce((sum, f) => sum + f.area, 0));

  let totalEstimatedWeight = $derived(() => {
    if (files.length === 0) return 0;
    
    // Heuristic Formula
    const shellVolume = totalSurfaceArea * (quality.shellThickness / 10); // Area in cm², thickness converted mm to cm
    const solidVolume = totalSolidVolume;
    
    // Ensure shell isn't bigger than solid
    const actualShell = Math.min(shellVolume, solidVolume);
    const innerVolume = Math.max(0, solidVolume - actualShell);
    
    const infillVolume = innerVolume * (infillPercent / 100);
    const totalVolume = actualShell + infillVolume;
    
    return totalVolume * material.density * quantity;
  });

  let totalCost = $derived(() => {
    if (files.length === 0) return 0;
    const weight = totalEstimatedWeight();
    
    const materialCost = weight * material.costPerGram;
    const subtotal = materialCost + config.settings.setupFee;
    const withBuffer = subtotal * (1 + config.settings.failureBufferPercent / 100);
    
    return withBuffer;
  });

  let technicalStats = $derived(() => {
    if (files.length === 0) return { volumeCm3: 0, printTime: '00:00:00', x: 0, y: 0, z: 0 };
    
    const weight = totalEstimatedWeight();
    const finalMaterialVolumeCm3 = weight / material.density;
    
    // Time heuristic based on volumetric flow rate
    const totalVolMm3 = finalMaterialVolumeCm3 * 1000;
    const flowRateMm3PerSec = 5 * (quality.layerHeight / 0.2); 
    const totalSeconds = (totalVolMm3 / flowRateMm3PerSec) + 300;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const printTimeStr = `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;

    // Calculate dimensions
    const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    if (THREE && scene) {
      files.forEach(f => {
        const mesh = scene.getObjectByProperty('uuid', f.meshUuid);
        if (mesh) {
          const bbox = new THREE.Box3().setFromObject(mesh);
          if (!bbox.isEmpty()) {
            box.minX = Math.min(box.minX, bbox.min.x);
            box.minY = Math.min(box.minY, bbox.min.y);
            box.minZ = Math.min(box.minZ, bbox.min.z);
            box.maxX = Math.max(box.maxX, bbox.max.x);
            box.maxY = Math.max(box.maxY, bbox.max.y);
            box.maxZ = Math.max(box.maxZ, bbox.max.z);
          }
        }
      });
    }

    const dimX = box.minX === Infinity ? 0 : (box.maxX - box.minX) / 10;
    const dimY = box.minX === Infinity ? 0 : (box.maxY - box.minY) / 10;
    const dimZ = box.minX === Infinity ? 0 : (box.maxZ - box.minZ) / 10;

    return {
      volumeCm3: finalMaterialVolumeCm3,
      printTime: printTimeStr,
      x: dimX,
      y: dimY,
      z: dimZ
    };
  });
  function updateMeshColor(meshUuid: string, colorId: string) {
    if (!scene) return;
    const c = config.colors.find(col => col.id === colorId);
    if (!c) return;
    
    scene.traverse((child: any) => {
      if (child.isMesh && child.material && child.material.color && child.userData?.fileId === meshUuid) {
        child.material.color.set(c.hex);
      }
    });
  }

  // Fallback reactivity to guarantee colors are painted
  $effect(() => {
    if (scene) {
      scene.traverse((child: any) => {
        if (child.isMesh && child.material && child.material.color && child.userData?.fileId) {
          const f = files.find(file => file.meshUuid === child.userData.fileId);
          if (f && f.colorId) {
            const c = config.colors.find(col => col.id === f.colorId);
            if (c) child.material.color.set(c.hex);
          }
        }
      });
    }
  });

  function handleGlobalColorChange(newColorId: string) {
    selectedColorId = newColorId;
    files.forEach((f, i) => {
      files[i].colorId = newColorId;
      updateMeshColor(f.meshUuid, newColorId);
    });
  }

  function applyLightMode(lightMode: boolean) {
    if (!scene || !THREE) return;
    scene.background = new THREE.Color(lightMode ? 0xf4f4f5 : 0x09090b);
    scene.traverse((child: any) => {
      if (child.userData?.isFloor) {
        if (lightMode) {
          child.material.color.setHex(0xc8c8cc);
          child.material.roughness = 0.65;
          child.material.metalness = 0.05;
        } else {
          child.material.color.setHex(0x1a1a22);
          child.material.roughness = 0.75;
          child.material.metalness = 0.08;
        }
        child.material.needsUpdate = true;
      }
      if (child.userData?.isGrid) {
        // GridHelper has two materials: [center lines, grid lines]
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m) {
            m.color?.setHex(lightMode ? 0x888890 : 0x4a4a58);
            m.needsUpdate = true;
          }
        });
      }
    });
  }

  function applyGridVisibility(visible: boolean) {
    if (!scene) return;
    scene.traverse((child: any) => {
      if (child.userData?.isFloorOrGrid) {
        child.visible = visible;
      }
    });
  }

  function applyBuildVolumeVisibility(visible: boolean) {
    if (!scene) return;
    scene.traverse((child: any) => {
      if (child.userData?.isBuildVolume) {
        child.visible = visible;
      }
    });
  }

  // Auto-orient: rotate model group so the largest flat face is on the floor (Z-up / Y-up for Three.js)
  function autoOrientMesh(meshGroup: any) {
    if (!THREE || !meshGroup) return;
    // Compute bounding box and pick axis with smallest extent as the "up" candidate
    const box = new THREE.Box3().setFromObject(meshGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    // The axis with the SMALLEST dimension becomes the vertical (Y) axis.
    // This puts the largest flat face down.
    const axes = [
      { axis: 'x', value: size.x },
      { axis: 'y', value: size.y },
      { axis: 'z', value: size.z },
    ];
    axes.sort((a, b) => a.value - b.value);
    const upAxis = axes[0].axis; // smallest dimension → treat as height
    if (upAxis === 'x') {
      meshGroup.rotation.z = Math.PI / 2;
    } else if (upAxis === 'z') {
      meshGroup.rotation.x = -Math.PI / 2;
    }
    // If upAxis === 'y', already correct for Three.js Y-up
    meshGroup.updateMatrixWorld(true);
    // Re-seat on floor
    const newBox = new THREE.Box3().setFromObject(meshGroup);
    meshGroup.position.y -= newBox.min.y;
  }

  function rotateSelected(axis: 'x' | 'y' | 'z', degrees: number) {
    if (!scene || !THREE) return;
    const targetUuid = selectedFileForRotation || (files.length === 1 ? files[0].meshUuid : null);
    if (!targetUuid) return;
    let meshGroup: any = null;
    scene.traverse((child: any) => { if (child.uuid === targetUuid) meshGroup = child; });
    if (!meshGroup) return;
    const rad = (degrees * Math.PI) / 180;
    if (axis === 'x') meshGroup.rotation.x += rad;
    if (axis === 'y') meshGroup.rotation.y += rad;
    if (axis === 'z') meshGroup.rotation.z += rad;
    meshGroup.updateMatrixWorld(true);
    // Re-seat on floor after rotation
    const newBox = new THREE.Box3().setFromObject(meshGroup);
    meshGroup.position.y -= newBox.min.y;
    // Re-check bed fit after manual rotation
    checkAllBedFit();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }
  
  function handleDragLeave() {
    isDragging = false;
  }
  
  async function processFiles(newFiles: File[]) {
    const validExtensions = ['.stl', '.obj', '.3mf'];
    const validFiles = newFiles.filter(f => {
      const ext = f.name.slice((f.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
      return validExtensions.includes('.' + ext) && f.size <= config.settings.maxFileSizeBytes;
    });

    if (validFiles.length === 0) return;

    isProcessing = true;
    
    if (!THREE) THREE = await import('three');
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');

    if (!scene) {
      initThreeJS(OrbitControls, RoomEnvironment);
    }

    const stlLoader = new STLLoader();
    const objLoader = new OBJLoader();
    const threeMFLoader = new ThreeMFLoader();

    for (const file of validFiles) {
      const extension = file.name.slice((file.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
      const buffer = await file.arrayBuffer();
      
      let fileVolume = 0;
      let fileArea = 0;
      const fileGroup = new THREE.Group();

      function processGeometry(geometry: any) {
        if (!geometry.attributes.normal) {
          geometry.computeVertexNormals();
        }
        
        let volume = 0, area = 0;
        const pos = geometry.attributes.position;
        if (pos) {
          const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();
          if (geometry.index) {
             const index = geometry.index.array;
             for (let i = 0; i < index.length; i += 3) {
                p1.fromBufferAttribute(pos, index[i]);
                p2.fromBufferAttribute(pos, index[i+1]);
                p3.fromBufferAttribute(pos, index[i+2]);
                const cb = new THREE.Vector3().subVectors(p3, p2);
                const ab = new THREE.Vector3().subVectors(p1, p2);
                area += cb.cross(ab).length() / 2;
                volume += p1.dot(new THREE.Vector3().crossVectors(p2, p3)) / 6.0;
             }
          } else {
             for (let i = 0; i < pos.count / 3; i++) {
                p1.fromBufferAttribute(pos, i * 3 + 0);
                p2.fromBufferAttribute(pos, i * 3 + 1);
                p3.fromBufferAttribute(pos, i * 3 + 2);
                const cb = new THREE.Vector3().subVectors(p3, p2);
                const ab = new THREE.Vector3().subVectors(p1, p2);
                area += cb.cross(ab).length() / 2;
                volume += p1.dot(new THREE.Vector3().crossVectors(p2, p3)) / 6.0;
             }
          }
        }
        
        fileVolume += Math.abs(volume) / 1000;
        fileArea += area / 100;

        const meshMaterial = new THREE.MeshStandardMaterial({ 
          color: color.hex, 
          roughness: 0.3,
          metalness: 0.1,
          side: 2
        });
        const mesh = new THREE.Mesh(geometry, meshMaterial);
        mesh.userData = { fileId: fileGroup.uuid };
        fileGroup.add(mesh);
      }

      try {
        if (extension === 'stl') {
          const geometry = stlLoader.parse(buffer);
          processGeometry(geometry);
        } else if (extension === 'obj') {
          const textDecoder = new TextDecoder('utf-8');
          const group = objLoader.parse(textDecoder.decode(buffer));
          group.traverse((child: any) => {
            if (child.isMesh && child.geometry) processGeometry(child.geometry);
          });
        } else if (extension === '3mf') {
          const group = threeMFLoader.parse(buffer);
          group.traverse((child: any) => {
            if (child.isMesh && child.geometry) processGeometry(child.geometry);
          });
        }
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err);
        continue;
      }

      if (fileGroup.children.length > 0) {
        // Center the mesh within the group first
        const fileBox = new THREE.Box3().setFromObject(fileGroup);
        const center = new THREE.Vector3();
        fileBox.getCenter(center);
        fileGroup.children.forEach(child => {
          child.position.sub(new THREE.Vector3(center.x, fileBox.min.y, center.z));
        });

        // Enable shadow casting on meshes
        fileGroup.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
          }
        });

        scene.add(fileGroup);

        // Auto-orient: put largest flat face on the floor
        autoOrientMesh(fileGroup);

        files = [...files, { 
          file, 
          volume: fileVolume, 
          area: fileArea, 
          meshUuid: fileGroup.uuid,
          colorId: selectedColorId
        }];
      }
    }
    
    isProcessing = false;
    
    if (files.length > 0) {
       layoutMeshes();
       checkAllBedFit();
       setTimeout(() => {
         if (canvasContainer && camera && renderer) {
           camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
           camera.updateProjectionMatrix();
           renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
           focusCamera();
         }
       }, 50);
    }
  }

  // Check if a model fits the printer bed in any of the 6 possible flat-face orientations.
  // For a bounding box (w, h, d), the 6 orientations produce 3 unique footprint+height combos:
  // each axis can be the "up" axis, giving footprint of the other two.
  function checkFitsBed(sizeX: number, sizeY: number, sizeZ: number): boolean {
    const bed = config.printerBed;
    const dims = [sizeX, sizeY, sizeZ];
    // All 6 permutations of [w, h, d]
    const perms = [
      [dims[0], dims[1], dims[2]],
      [dims[0], dims[2], dims[1]],
      [dims[1], dims[0], dims[2]],
      [dims[1], dims[2], dims[0]],
      [dims[2], dims[0], dims[1]],
      [dims[2], dims[1], dims[0]],
    ];
    // For each permutation: [footX, footZ, height]
    // It fits if footX <= bed.x AND footZ <= bed.z AND height <= bed.y
    return perms.some(([fx, fz, ht]) => fx <= bed.x && fz <= bed.z && ht <= bed.y);
  }

  function checkAllBedFit() {
    if (!THREE || !scene) return;
    const newWarnings = new Map<string, string>();
    files.forEach(f => {
      let grp: any = null;
      scene.traverse((child: any) => { if (child.uuid === f.meshUuid) grp = child; });
      if (!grp) return;
      const box = new THREE.Box3().setFromObject(grp);
      const size = new THREE.Vector3();
      box.getSize(size);
      const fits = checkFitsBed(size.x, size.y, size.z);
      if (!fits) {
        const bed = config.printerBed;
        newWarnings.set(
          f.meshUuid,
          `"${f.file.name}" is ${size.x.toFixed(0)}×${size.z.toFixed(0)}×${size.y.toFixed(0)} mm — exceeds printer bed (${bed.x}×${bed.z}×${bed.y} mm) in all orientations`
        );
      }
    });
    bedWarnings = newWarnings;
  }

  function layoutMeshes() {
    if (!scene || !THREE || files.length === 0) return;
    const padding = 20; // mm gap between objects

    // Step 1: collect groups, reset their X/Z, measure bbox center offset
    const groups: { group: any; sizeX: number; offsetX: number; offsetZ: number }[] = [];
    files.forEach(f => {
      let grp: any = null;
      scene.traverse((child: any) => { if (child.uuid === f.meshUuid) grp = child; });
      if (!grp) return;

      // Reset X/Z so we measure from a known baseline
      grp.position.x = 0;
      grp.position.z = 0;

      // Measure the world bbox — its center tells us where the mesh actually sits
      // relative to the group origin (due to rotation offsets)
      const box = new THREE.Box3().setFromObject(grp);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      groups.push({
        group: grp,
        sizeX: size.x,
        offsetX: center.x, // how far the bbox center is from group origin in X
        offsetZ: center.z, // how far the bbox center is from group origin in Z
      });
    });

    // Step 2: lay out along X centered at world X=0, correct for bbox offset
    const totalWidth = groups.reduce((s, g) => s + g.sizeX, 0) + padding * (groups.length - 1);
    let curX = -totalWidth / 2;

    groups.forEach(({ group, sizeX, offsetX, offsetZ }) => {
      const targetCenterX = curX + sizeX / 2;
      // Move group so bbox center lands at targetCenterX, Z=0
      group.position.x = targetCenterX - offsetX;
      group.position.z = -offsetZ;
      curX += sizeX + padding;

      // Re-seat on floor after moving
      const b = new THREE.Box3().setFromObject(group);
      if (b.min.y < 0) group.position.y -= b.min.y;
      if (b.min.y > 0.5) group.position.y -= b.min.y; // also fix if floating
    });
  }


  function focusCamera() {
    if (!scene || !camera || !controls || files.length === 0 || !THREE) return;
    
    const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    
    files.forEach(f => {
      let meshGroup = null;
      scene.traverse((child: any) => {
        if (child.uuid === f.meshUuid) meshGroup = child;
      });
      
      if (meshGroup) {
        const bbox = new THREE.Box3().setFromObject(meshGroup);
        if (!bbox.isEmpty()) {
          box.minX = Math.min(box.minX, bbox.min.x);
          box.minY = Math.min(box.minY, bbox.min.y);
          box.minZ = Math.min(box.minZ, bbox.min.z);
          box.maxX = Math.max(box.maxX, bbox.max.x);
          box.maxY = Math.max(box.maxY, bbox.max.y);
          box.maxZ = Math.max(box.maxZ, bbox.max.z);
        }
      }
    });

    if (box.minX === Infinity) return;

    const sizeX = box.maxX - box.minX;
    const sizeY = box.maxY - box.minY;
    const sizeZ = box.maxZ - box.minZ;
    
    const centerX = (box.maxX + box.minX) / 2;
    const centerY = (box.maxY + box.minY) / 2;
    const centerZ = (box.maxZ + box.minZ) / 2;

    const maxDim = Math.max(sizeX, sizeY, sizeZ);
    const fov = camera.fov * (Math.PI / 180);
    // 1.2x gives ~75% fill of the viewport — tight and close
    let dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.2;

    // Nice 3/4 isometric angle (45° horizontal, 35° elevation)
    const angle = Math.PI / 4; // 45 degrees horizontal
    const elevation = Math.PI / 5; // ~36 degrees up
    camera.position.set(
      centerX + dist * Math.sin(angle) * Math.cos(elevation),
      centerY + sizeY / 2 + dist * Math.sin(elevation),
      centerZ + dist * Math.cos(angle) * Math.cos(elevation)
    );

    controls.target.set(centerX, centerY * 0.4, centerZ);
    controls.update();
  }

  function initThreeJS(OrbitControls: any, RoomEnvironment: any) {
    if (!canvasContainer || !THREE) return;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f5);

    camera = new THREE.PerspectiveCamera(45, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 5000);
    camera.position.set(200, 160, 200);

    // Hemisphere — very dim base so unlit faces are dark (creates contrast/depth)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.15);
    scene.add(hemiLight);

    // Strong key from top-left — main shaping light
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(-200, 300, 150);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 2000;
    keyLight.shadow.camera.left = -500;
    keyLight.shadow.camera.right = 500;
    keyLight.shadow.camera.top = 500;
    keyLight.shadow.camera.bottom = -500;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);

    // Weak fill from opposite side — just enough to see detail in shadows
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.2);
    fillLight.position.set(200, 100, -200);
    scene.add(fillLight);

    // Camera-attached rim — highlights the silhouette edge facing you
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.12);
    camera.add(rimLight);
    scene.add(camera);

    // Renderer — set up BEFORE building env map
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.75; // lower exposure = truer colours, less washout
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasContainer.appendChild(renderer.domElement);

    // Build a simple env map so MeshPhysicalMaterial can reflect
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    // Use a neutral dark studio environment
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x111113);
    // Add a faint warm point above to give the model a nice reflection highlight
    const envPt = new THREE.PointLight(0xffffff, 0.8, 0);
    envPt.position.set(0, 200, 0);
    envScene.add(envPt);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment()).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Realistic dark studio floor — matte with just a hint of sheen
    const floorGeo = new THREE.PlaneGeometry(2000, 2000);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a22,
      roughness: 0.45,
      metalness: 0.60,
      envMapIntensity: 0.35,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    floor.userData = { isFloorOrGrid: true, isFloor: true };
    scene.add(floor);

    // Grid — brighter lines so they're visible in dark mode
    const gridHelper = new THREE.GridHelper(2000, 20, 0x4a4a58, 0x2e2e3a);
    gridHelper.position.y = 0.3;
    gridHelper.userData = { isFloorOrGrid: true, isGrid: true };
    scene.add(gridHelper);

    // Printer build volume wireframe box (centered on floor)
    const bed = config.printerBed;
    const bvGeo = new THREE.BoxGeometry(bed.x, bed.y, bed.z);
    const bvEdges = new THREE.EdgesGeometry(bvGeo);
    const bvMat = new THREE.LineBasicMaterial({
      color: 0xff6a00,       // bright orange — easy to spot
      transparent: true,
      opacity: 0.55,
    });
    const buildVolumeBox = new THREE.LineSegments(bvEdges, bvMat);
    // Sit the bottom face on Y=0 (floor level)
    buildVolumeBox.position.set(0, bed.y / 2, 0);
    buildVolumeBox.userData = { isBuildVolume: true };
    scene.add(buildVolumeBox);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 20;
    controls.maxDistance = 2000;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Apply default light mode colours to floor & grid
    applyLightMode(true);

    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      if (canvasContainer && camera && renderer) {
        const w = canvasContainer.clientWidth;
        const h = canvasContainer.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
  }

  function removeFile(index: number) {
    if (scene) {
      let meshGroup = null;
      scene.traverse((child: any) => {
        if (child.uuid === files[index].meshUuid) meshGroup = child;
      });
      if (meshGroup) scene.remove(meshGroup);
    }
    const removedUuid = files[index].meshUuid;
    files = files.filter((_, idx) => idx !== index);
    // Clear any warning for the removed file
    const w = new Map(bedWarnings);
    w.delete(removedUuid);
    bedWarnings = w;
    if (files.length > 0) {
      layoutMeshes();
      focusCamera();
    }
  }

  async function submitQuote() {
    isSubmitting = true;
    submitError = '';
    
    try {
      const payload = {
        name: customerName,
        email: customerEmail,
        material: material.name,
        color: color.name,
        quality: quality.name,
        quantity,
        infill: infillPercent,
        totalCost: totalCost().toFixed(2),
        files: files.map(f => ({
          name: f.file.name,
          volume: f.volume.toFixed(1)
        }))
      };

      const res = await fetch('/api/submit-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        submitSuccess = true;
      } else {
        submitError = data.error || 'Failed to submit quote.';
      }
    } catch (err: any) {
      submitError = err.message || 'Network error occurred.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex flex-col space-y-8">
  
  <!-- Top Section: Uploader and Viewer -->
  <div class="space-y-6">
    <!-- Uploader -->
    {#if files.length === 0}
    <div 
      class="border-2 border-dashed rounded-2xl p-12 text-center transition-colors {isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'}"
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      role="region"
      aria-label="Drop 3D files here"
    >
      <div class="w-16 h-16 mx-auto bg-zinc-800 rounded-full flex items-center justify-center mb-4">
        {#if isProcessing}
          <div class="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        {:else}
          <svg class="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
        {/if}
      </div>
      <h3 class="text-xl font-medium text-zinc-200 mb-2">{isProcessing ? 'Processing 3D Mesh...' : 'Drag & Drop 3D Files'}</h3>
      <p class="text-zinc-500 text-sm mb-6">Supports .STL, .OBJ, and .3MF (up to {config.settings.maxFileSizeBytes / 1024 / 1024}MB)</p>
      
      <label class="px-6 py-3 bg-white text-zinc-950 font-medium rounded-full cursor-pointer hover:bg-zinc-200 transition-colors inline-block {isProcessing ? 'opacity-50 pointer-events-none' : ''}">
        Browse Files
        <input type="file" multiple accept=".stl,.obj,.3mf" class="hidden" onchange={(e) => processFiles(Array.from(e.currentTarget.files || []))} disabled={isProcessing} />
      </label>
    </div>
    {/if}

    <!-- 3D Viewport always rendered but hidden if empty -->
    <div 
      bind:this={canvasContainer} 
      class="aspect-[4/3] w-full bg-zinc-900 border {isDragging ? 'border-indigo-500' : 'border-zinc-800'} rounded-2xl overflow-hidden relative shadow-inner {files.length === 0 ? 'hidden' : 'block'}"
      ondrop={handleDrop}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      role="region"
      aria-label="3D Viewport Dropzone"
    >
      {#if isProcessing}
        <div class="absolute inset-0 z-20 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center flex-col">
          <div class="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <span class="text-indigo-400 font-medium tracking-wide">Processing Mesh...</span>
        </div>
      {/if}

      <!-- Bed-fit warnings -->
      {#if bedWarnings.size > 0}
        <div class="absolute bottom-20 left-4 right-4 z-10 flex flex-col gap-2 pointer-events-none">
          {#each [...bedWarnings.values()] as warning}
            <div class="flex items-start gap-2.5 bg-red-950/90 backdrop-blur border border-red-600/60 text-red-300 rounded-xl px-4 py-3 shadow-xl text-xs leading-relaxed">
              <!-- Warning icon -->
              <svg class="w-4 h-4 mt-0.5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
              </svg>
              <span><strong class="text-red-200 font-semibold">Not printable:</strong> {warning}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Control Buttons -->
      {#if files.length > 0}
        <!-- Top-right: Light/Grid toggles -->
        <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
          <!-- Light/Dark Mode Button -->
          <button 
            class="bg-zinc-950/80 backdrop-blur border border-zinc-800 hover:border-zinc-700 text-zinc-300 p-2 rounded-lg shadow-lg transition-colors"
            onclick={() => { isLightMode = !isLightMode; applyLightMode(isLightMode); }}
            title="Toggle Light/Dark Background"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {#if isLightMode}
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
              {/if}
            </svg>
          </button>

          <!-- Grid Toggle Button -->
          <button 
            class="bg-zinc-950/80 backdrop-blur border border-zinc-800 hover:border-zinc-700 text-zinc-300 p-2 rounded-lg shadow-lg transition-colors"
            onclick={() => { showGridAndFloor = !showGridAndFloor; applyGridVisibility(showGridAndFloor); }}
            title="Toggle Floor Grid"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {#if showGridAndFloor}
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4h16v16H4V4zm0 4h16M4 12h16M4 16h16M8 4v16M12 4v16M16 4v16"></path>
              {:else}
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
              {/if}
            </svg>
          </button>

          <!-- Build Volume Toggle Button -->
          <button
            class="bg-zinc-950/80 backdrop-blur border {showBuildVolume ? 'border-orange-600/70 text-orange-400' : 'border-zinc-800 text-zinc-500'} hover:border-orange-500/80 p-2 rounded-lg shadow-lg transition-colors"
            onclick={() => { showBuildVolume = !showBuildVolume; applyBuildVolumeVisibility(showBuildVolume); }}
            title="Toggle Printer Build Volume ({config.printerBed.x}×{config.printerBed.z}×{config.printerBed.y}mm)"
          >
            <!-- Cube / build-volume icon -->
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"></path>
            </svg>
          </button>
        </div>

        <!-- Bottom-left: Rotation controls -->
        <div class="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
          <!-- File selector if multiple files -->
          {#if files.length > 1}
            <select
              class="bg-zinc-950/90 backdrop-blur border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 shadow-lg"
              onchange={(e) => { selectedFileForRotation = e.currentTarget.value; }}
            >
              {#each files as f, i}
                <option value={f.meshUuid}>{f.file.name.slice(0, 20)}</option>
              {/each}
            </select>
          {/if}
          <div class="flex gap-1.5 items-center">
            <span class="text-zinc-500 text-[10px] uppercase tracking-wider font-semibold mr-1">Rotate</span>
            <!-- Rotate X -->
            <button
              class="bg-zinc-950/90 backdrop-blur border border-red-900/60 hover:border-red-500/80 text-red-400 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all hover:scale-105"
              onclick={() => rotateSelected('x', 90)}
              title="Rotate 90° around X axis"
            >X</button>
            <!-- Rotate Y -->
            <button
              class="bg-zinc-950/90 backdrop-blur border border-green-900/60 hover:border-green-500/80 text-green-400 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all hover:scale-105"
              onclick={() => rotateSelected('y', 90)}
              title="Rotate 90° around Y axis"
            >Y</button>
            <!-- Rotate Z -->
            <button
              class="bg-zinc-950/90 backdrop-blur border border-blue-900/60 hover:border-blue-500/80 text-blue-400 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all hover:scale-105"
              onclick={() => rotateSelected('z', 90)}
              title="Rotate 90° around Z axis"
            >Z</button>
            <!-- Re-focus camera -->
            <button
              class="bg-zinc-950/90 backdrop-blur border border-zinc-700 hover:border-indigo-500/80 text-indigo-400 px-2.5 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all hover:scale-105 ml-1"
              onclick={() => focusCamera()}
              title="Reset camera to fit model"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.069A1 1 0 0121 8.87V17a1 1 0 01-1.447.894L15 16M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"></path></svg>
            </button>
          </div>
        </div>
      {/if}
    </div>
    
    {#if files.length > 0}
      <!-- File List -->
      <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 max-w-2xl mx-auto w-full">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-medium text-zinc-400 uppercase tracking-wider">Uploaded Files ({files.length})</h4>
          
          <label class="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded cursor-pointer transition-colors {isProcessing ? 'opacity-50 pointer-events-none' : ''}">
            + Add Files
            <input type="file" multiple accept=".stl,.obj,.3mf" class="hidden" onchange={(e) => processFiles(Array.from(e.currentTarget.files || []))} disabled={isProcessing} />
          </label>
        </div>
        <ul class="space-y-2">
          {#each files as f, i (i)}
            <li class="flex items-center justify-between p-3 bg-zinc-950 rounded-lg border border-zinc-800/50 gap-4">
              <div class="flex flex-col flex-1 min-w-0">
                <span class="text-sm font-medium text-zinc-200 truncate">{f.file.name}</span>
                <span class="text-xs text-zinc-500">{f.volume.toFixed(1)} cm³ | {(f.file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              
              <div class="w-32 shrink-0">
                <Dropdown 
                  options={config.colors} 
                  bind:value={files[i].colorId} 
                  formatLabel={(c) => c.name}
                  hasColor={true}
                  small={true}
                  onChange={(newId) => updateMeshColor(f.meshUuid, newId)}
                />
              </div>

              <button class="text-zinc-500 hover:text-red-400 transition-colors p-2 shrink-0" onclick={() => removeFile(i)}>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  <!-- Bottom Section: Settings & Price -->
  <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 md:p-8 shadow-xl relative overflow-hidden mt-6">
    <!-- Glow effect -->
    <div class="absolute -top-12 -right-12 w-48 h-48 bg-indigo-500/10 blur-3xl rounded-full"></div>
    
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-12 relative z-10">
      
      <!-- Customization Form -->
      <div class="space-y-6 lg:col-span-3">
        <h3 class="text-2xl font-bold mb-6 font-heading text-zinc-100">Customization</h3>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Material -->
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-zinc-400 mb-1.5">Material</label>
            <Dropdown 
              options={config.materials} 
              bind:value={selectedMaterialId} 
              formatLabel={(m) => m.name}
            />
          </div>

          <!-- Color -->
          <div class="md:col-span-1">
            <label class="block text-sm font-medium text-zinc-400 mb-1.5" title="Changes color for all files">Global Color</label>
            <Dropdown 
              options={config.colors} 
              bind:value={selectedColorId} 
              formatLabel={(c) => c.name}
              hasColor={true}
              onChange={handleGlobalColorChange}
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Quality / Nozzle -->
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-zinc-400 mb-1.5">Quality (Nozzle Size)</label>
            <Dropdown 
              options={config.qualities} 
              bind:value={selectedQualityId} 
              formatLabel={(q) => q.name}
            />
          </div>
          
          <!-- Quantity -->
          <div class="md:col-span-1">
            <label class="block text-sm font-medium text-zinc-400 mb-1.5">Quantity</label>
            <div class="flex items-center w-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden h-[50px] shadow-inner transition-colors hover:border-zinc-700 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/50">
              <button type="button" class="w-12 h-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors" onclick={() => quantity = Math.max(1, quantity - 1)}>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>
              </button>
              <input type="number" min="1" max="1000" bind:value={quantity} class="flex-1 bg-transparent text-center text-zinc-200 focus:outline-none font-medium h-full" />
              <button type="button" class="w-12 h-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors" onclick={() => quantity++}>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Infill -->
        <div>
          <div class="flex justify-between items-center mb-1.5">
            <label class="text-sm font-medium text-zinc-400" for="infill">Infill Density</label>
            <span class="text-sm text-indigo-400 font-medium bg-indigo-500/10 px-2 py-0.5 rounded">{infillPercent}%</span>
          </div>
          <input type="range" id="infill" min="0" max="100" step="5" bind:value={infillPercent} class="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
        </div>

        <!-- Technical Details Grid -->
        {#if files.length > 0}
        <div class="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 border border-zinc-800/60 bg-zinc-900/30 p-4 rounded-xl">
          <div>
            <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">Est. Print Time</div>
            <div class="text-sm font-medium text-zinc-200">{technicalStats().printTime}</div>
          </div>
          <div>
            <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">Material Vol.</div>
            <div class="text-sm font-medium text-zinc-200">{technicalStats().volumeCm3.toFixed(1)} cm³</div>
          </div>
          <div>
            <div class="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-semibold">Dimensions (cm)</div>
            <div class="text-sm font-medium text-zinc-200 truncate" title="{technicalStats().x.toFixed(2)} x {technicalStats().y.toFixed(2)} x {technicalStats().z.toFixed(2)}">
              {technicalStats().x.toFixed(1)} × {technicalStats().y.toFixed(1)} × {technicalStats().z.toFixed(1)}
            </div>
          </div>
        </div>
        {/if}
      </div>

      <!-- Estimation Summary -->
      <div class="flex flex-col justify-center bg-zinc-950/50 p-6 rounded-xl border border-zinc-800 lg:col-span-2">
        <h3 class="text-lg font-bold mb-5 font-heading text-zinc-200">Quote Summary</h3>
        
        <div class="space-y-4 mb-8 text-sm">
          <div class="flex justify-between">
            <span class="text-zinc-500">Material Weight</span>
            <span class="text-zinc-300 font-medium">{totalEstimatedWeight().toFixed(1)}g</span>
          </div>
          <div class="flex justify-between">
            <span class="text-zinc-500">Setup Fee</span>
            <span class="text-zinc-300 font-medium">{currencySymbol}{config.settings.setupFee.toFixed(2)}</span>
          </div>
        </div>

        <hr class="border-zinc-800 mb-6" />

        {#if submitSuccess}
          <div class="bg-green-500/10 border border-green-500 text-green-400 p-4 rounded-lg mb-6 text-center shadow-inner">
            <svg class="w-8 h-8 mx-auto mb-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <h4 class="font-bold text-lg mb-1">Quote Submitted!</h4>
            <p class="text-sm">We've received your request and will contact you shortly.</p>
          </div>
        {:else}
          <div class="space-y-4 mb-8">
            <div>
              <label class="block text-sm font-medium text-zinc-400 mb-1.5">Your Name</label>
              <input type="text" bind:value={customerName} class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors hover:border-zinc-700" placeholder="John Doe" />
            </div>
            <div>
              <label class="block text-sm font-medium text-zinc-400 mb-1.5">Your Email</label>
              <input type="email" bind:value={customerEmail} class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors hover:border-zinc-700" placeholder="john@example.com" />
            </div>
          </div>

          <div class="flex items-end justify-between mb-6">
            <span class="text-sm text-zinc-400">Total Estimated Cost</span>
            <span class="text-4xl font-bold text-white font-heading">{currencySymbol}{totalCost().toFixed(2)} <span class="text-base text-zinc-500 font-normal">{currencyCode}</span></span>
          </div>

          {#if submitError}
            <div class="text-red-400 text-sm mb-4 bg-red-500/10 p-3 rounded-lg border border-red-500/20">{submitError}</div>
          {/if}

          <button 
            class="w-full py-4 px-6 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-lg shadow-lg shadow-indigo-500/20 transition-all uppercase tracking-wider text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={submitQuote}
            disabled={isSubmitting || !customerName || !customerEmail}
          >
            {isSubmitting ? 'Submitting...' : 'Submit for Final Quote'}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
