You are an expert frontend engineer building a high-performance, open-source, whitelabel 3D printing quotation web application. 

### Core Tech Stack
- Meta-Framework: Astro (Hybrid/SSR mode to support an API endpoint for sending emails)
- Island UI Framework: Svelte 5 (For the interactive pricing app, chosen for minimum bundle size and raw performance)
- 3D Rendering: Three.js (Imported dynamically ONLY when a file is uploaded)
- Styling: TailwindCSS

### Project Architecture
1. Setup a whitelabel configuration file at `src/config.ts`. It must export an object containing:
   - Currency symbol, Brand Name, Contact details.
   - SMTP Settings (Host, Port, User, Pass) for Nodemailer to send quote emails.
   - Materials array: Name (PLA, PETG, Resin, etc.), Density (g/cm³), Base cost per kg, and Deposition Rate (grams per hour).
   - Nozzles array: Diameter (0.4mm, 0.6mm, etc.), Print time multiplier, Shell thickness multiplier.
   - Base Formula Rates: Setup fee, Markup multiplier (profit margin), Machine runtime cost per hour, Labor rate per hour.
   - Settings: Default max file size (25MB default, configurable), Failure Buffer (e.g., 10%).

2. Render the primary page layout statically inside `src/pages/index.astro`. 

3. Build the core quoting machine inside a single Svelte 5 component: `src/components/QuoteEngine.svelte`. Mount it in your Astro file using the `client:idle` directive so it does not block the initial page load.

4. Create a serverless API route `src/pages/api/submit-quote.ts` that uses Nodemailer to send the quote to the user and the shop owner using the provided SMTP credentials.

### Technical Requirements for the Svelte 5 Component
- Use Svelte 5 Runes (`$state`, `$derived`, `$effect`) for all reactive variables and state management.
- Create a drag-and-drop file uploader area that accepts `.stl`, `.obj`, and `.3mf` files. Support multi-file uploads. Check files against the max file size limit (default 25MB).
- To keep the initial bundle ultra-light, do not import Three.js at the top of the file. Use a dynamic import (`await import('three')`) inside a function triggered ONLY after the user drops a file.
- Use Three.js loaders (like `STLLoader`, `OBJLoader`, `3MFLoader`) to parse the binary entirely client-side in the browser. 
- Extract the precise dimensions (X, Y, Z in mm).
- **Mathematical Estimation (Crucial)**: Since doing full G-code slicing in the browser is too heavy, you must use heuristic formulas:
  - Calculate `Solid Volume` (cm³) and `Surface Area` (cm²) of the mesh.
  - Calculate `Shell Volume` ≈ `Surface Area` × (`Nozzle Size` × `Wall Line Count`).
  - Calculate `Infill Volume` ≈ (`Solid Volume` - `Shell Volume`) × (`Infill %` / 100).
  - Calculate `Total Estimated Weight` = (`Shell Volume` + `Infill Volume`) × `Material Density`. 
  - Calculate `Estimated Print Time` = `Total Estimated Weight` / `Deposition Rate`.
- Render a lightweight, responsive 3D viewport canvas displaying the uploaded models with zoom/rotate controls using Three.js. (Secondary feature to add later: change color based on selected material).
- Create reactive UI controls using Svelte 5 for: Material, Infill % (slider), Nozzle Size, Print Quality, and Quantity.
- Implement an instant, reactive mathematical pricing engine using Svelte 5's `$derived` rune to calculate:
  - Material Cost + Machine Operating Cost + Labor + Setup Fee + Failure Buffer.
- Include a Checkout/Quote Submission form that submits to the `/api/submit-quote` endpoint.

### Project Output
Ensure the code is heavily commented, uses clean TypeScript, and contains a clear README.md explaining how any non-developer can modify `src/config.ts` to launch their own brand.