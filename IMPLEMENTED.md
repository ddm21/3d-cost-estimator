# 3D Print Cost Estimator - Implementation Details

## Overview
This document outlines the architecture, UI features, customization options, and math formulas implemented for the 3D Print Cost Estimator. The app was built using **Astro**, **Svelte 5**, **Tailwind CSS**, and **Three.js**.

## User Interface (UI)
The application uses a sleek, modern, dark-themed UI (zinc/indigo) built heavily around visual feedback and responsiveness.
- **Max Width**: The application operates at a focused `1000px` max-width.
- **Dynamic Grid Proportion**: The customization interface uses a 60/40 proportional split, dedicating more space to configuration toggles while maintaining a compact, readable Quote Summary.
- **Drag & Drop Uploader**: A prominent zone to drop `.stl`, `.obj`, and `.3mf` files. Includes file size validation and parsing indicators.
- **Technical Stats Display**: A data grid surfaces precise technical metrics below the toggles:
  - **Est. Print Time**: Volumetric flow rate heuristic calculated mathematically via nozzle size (layer height relative to standard speeds).
  - **Material Vol (cm³)**: Precise representation of the consumed volume, adjusted based on selected infill and outer shell densities.
  - **Dimensions (cm)**: Deep physical bounding box calculations extract exact X/Y/Z object measurements.
- **Custom Components**: Default HTML `<select>` elements and `<input type="number">` were replaced with custom Svelte glassmorphism dropdowns and SVG-driven `+` / `-` selectors for a premium aesthetic.

## 3D Rendering Engine (Three.js)
The app uses a client-side Three.js renderer built directly into the Svelte ecosystem:
- **Proxy Bypass & Reactive Colors**: Because Svelte 5 automatically wraps `$state` objects in proxies (which crashes WebGL operations), the architecture traverses the un-proxied native `Three.Scene` directly. This enables the color dropdown to instantaneously re-shade the live object.
- **Studio Lighting**: Replaced flat illumination with a multi-source lighting setup. A `DirectionalLight` is mounted directly to the orbit camera (acting like a headlamp) to ensure all visible faces are illuminated, complemented by an ambient `HemisphereLight`.
- **Mesh Gounding & Environment**:
  - The viewport automatically recalculates aspect ratio dynamically (`4:3`).
  - Added a `GridHelper` and infinite floor plane `Mesh` to provide scale context. 
  - Uploaded models have their bounding boxes calculated, and they are dynamically pushed up exactly on the Y-axis so they rest flawlessly on the floor (Y=0).
  - An interactive, glassy UI toggle sits within the viewport to enable/disable the Floor & Grid on demand.
- **Assembly Parsing & Layout**: 
  - **Multi-mesh Formats**: `.obj` and `.3mf` files are deeply traversed. All internal geometries are extracted, individually measured for volume, and added to a single parent `THREE.Group` to perfectly maintain assemblies without missing parts.
  - **File Stacking**: If multiple files are uploaded (e.g., Body and Lid), the `layoutMeshes()` algorithm prevents them from clipping at `(0,0,0)`. It calculates individual bounding box widths and dynamically lays out every object side-by-side on the floor with a 20mm gap, automatically re-centering the entire collective assembly!

## Customization Options (config.ts)
A centralized `src/config.ts` handles all shop configurations. It makes it easy for non-developers to extend the app.
1. **Materials**: Supports PLA ($4.00/g), PETG ($4.80/g), ABS ($4.80/g), TPU ($7.20/g), ASA ($6.40/g), and Nylon ($12.80/g). Pricing tiers are proportionally balanced.
2. **Colors**: Massively expanded 16-color global dictionary ranging from standard monochrome tones (Black, White, Silver, Grey) to vivid, high-saturation filaments (Forest Green, Cyan, Purple, Bone, Magenta). Hex codes map to UI swatches and 3D materials simultaneously.
3. **Quality (Nozzle Sizes)**: Options ranging from Draft (0.8mm) to Ultra Fine (0.2mm). These values define `layerHeight` and `shellThickness`.
4. **Infill**: A 0-100% visual slider.
5. **Quantity**: Custom selector to dictate how many copies are needed.

## Math Formula & Estimation Logic
The app uses a heuristic formula to calculate the weight of the print, bypassing the need for a slow and complex slicing engine on the server.

### 1. Volume & Area Calculation
When a file is uploaded, the parser calculates the **Solid Volume (cm³)** and the **Surface Area (cm²)** mathematically based on the geometric mesh triangles.

### 2. Estimated Weight Formula
```javascript
// Convert thickness mm to cm
shellVolume = totalSurfaceArea * (quality.shellThickness / 10)

// Ensure shell isn't mathematically bigger than the solid boundary
actualShell = Math.min(shellVolume, solidVolume)
innerVolume = Math.max(0, solidVolume - actualShell)

// Apply infill percentage to the inner cavity
infillVolume = innerVolume * (infillPercent / 100)
totalVolume = actualShell + infillVolume

// Derive final weight
estimatedWeight = totalVolume * material.density * quantity
```
*Note: We assume a simplified model where the outer shell volume is constrained by surface area and nozzle thickness, and the inner cavity is filled based on the user's Infill %.*

### 3. Total Cost Formula
The final quote simplifies standard hourly rates to a straightforward material + setup fee calculation:
```javascript
materialCost = estimatedWeight * material.costPerGram
subtotal = materialCost + setupFee

// Apply failure buffer (e.g., 10%)
finalCost = subtotal * (1 + failureBufferPercent / 100)
```
*Note: The frontend UI purposely conceals the `failureBufferPercent` from the Quote Summary list, silently baking the margin into the final calculated cost to prevent buyer friction.*

## Backend API & Email Dispatch
- **Nodemailer Integration**: An Astro API endpoint was created at `src/pages/api/submit-quote.ts`.
- **Environment Variables**: Sensitive SMTP configuration (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) and Currency settings (`PUBLIC_CURRENCY_SYMBOL`, `PUBLIC_CURRENCY_CODE`) are abstracted to an `.env` file.
- **Email Workflow**: When the "Submit for Final Quote" button is pressed, a structured HTML email is dispatched to the shop owner detailing the exact specs, file volumes, customer contact info, and the total estimated quote.

## Bug Fixes & Improvements

### Color Picker Fix (Global & Per-File)
- **Issue**: Neither the global color picker nor the per-file color picker in the uploaded files list was applying color to the 3D mesh.
- **Root Cause**: The `onChange` callback prop was declared in the TypeScript type signature of `Dropdown.svelte` but was **never destructured** from `$props()`, making it always `undefined`.
- **Fix**: Added `onChange` to the destructured props in `Dropdown.svelte`. Both pickers now correctly call their handlers (`handleGlobalColorChange` and `updateMeshColor`) and apply colors to Three.js meshes instantly.

### Light/Dark Mode & Grid Toggle Fix (3D Viewport)
- **Issue**: The sun/moon toggle and grid toggle buttons in the 3D viewport had no visible effect.
- **Root Cause**: The `$effect()` that handled these changes depended on `scene` and `THREE`, which are plain `let` variables (not `$state`). Svelte 5's reactivity system does not track non-`$state` variables as effect dependencies. On first run, `scene` was `null`, so the effect bailed out. Subsequent `isLightMode` toggles could not reliably mutate the already-initialized scene.
- **Fix**: Replaced the `$effect` with two imperative functions — `applyLightMode(lightMode)` and `applyGridVisibility(visible)` — called directly from the button `onclick` handlers. This guarantees Three.js mutations run immediately and correctly every time.

### Translucent Floor Plane
- **Change**: The infinite floor `Mesh` in the 3D viewport is now semi-transparent (`opacity: 0.35`).
- **Detail**: Added `transparent: true` alongside `opacity: 0.35` to the `MeshStandardMaterial`. In Three.js, `opacity` has no effect unless `transparent` is explicitly set to `true`.

### Default Color Changed to White
- **Change**: The default selected filament color is now **White** instead of Black.
- **Detail**: Reordered the `colors` array in `src/config.ts` so that `{ id: "white" }` is the first entry. Since `QuoteEngine.svelte` initialises `selectedColorId` with `config.colors[0].id`, this automatically makes White the default for both the global picker and all newly uploaded files.
