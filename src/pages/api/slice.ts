import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);

export const POST = async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const infill = formData.get('infill') || '20';
    // For OrcaSlicer, we can pass basic overrides via CLI or just slice with defaults
    // and rely on the model geometry to give us a realistic G-Code estimation.
    // Full configuration would require generating a custom config.ini.
    
    if (!file) {
      return new Response(JSON.stringify({ success: false, error: 'No file provided' }), { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Create a temporary working directory
    const tempDir = path.join(process.cwd(), 'tmp_uploads');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create unique filenames
    const uniqueId = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const tempFilePath = path.join(tempDir, `${uniqueId}-${safeFilename}`);
    const gcodeFilePath = tempFilePath + '.gcode';

    await fs.writeFile(tempFilePath, buffer);

    try {
      // Execute the slicer in the background
      // Note: In Docker, `orcaslicer` is our xvfb-run wrapper script.
      // If developing locally on Windows/Mac, you'd need the slicer installed and in PATH,
      // or we can mock the response if the slicer command is missing.
      
      const isWindows = os.platform() === 'win32';
      const slicerCmd = process.env.SLICER_CMD || (isWindows ? 'prusa-slicer-console.exe' : 'orcaslicer');
      
      // Run slicer headless, export gcode
      await execAsync(`${slicerCmd} --export-gcode --fill-density ${infill}% --output "${gcodeFilePath}" "${tempFilePath}"`);

      // Read the generated gcode to extract stats
      // Slicers append metadata at the end of the file.
      const gcodeData = await fs.readFile(gcodeFilePath, 'utf-8');
      
      // Typical Slic3r/PrusaSlicer/Orca comments:
      // ; filament used [cm3] = 12.34
      // ; filament used [g] = 15.67
      // ; estimated printing time (normal mode) = 1h 2m 3s
      
      let volumeCm3 = 0;
      let weightG = 0;
      let printTimeStr = '00:00:00';
      let printTimeSeconds = 0;

      const lines = gcodeData.split('\n');
      for (const line of lines) {
        if (line.includes('filament used [cm3] =')) {
          volumeCm3 = parseFloat(line.split('=')[1].trim());
        }
        if (line.includes('filament used [g] =')) {
          weightG = parseFloat(line.split('=')[1].trim());
        }
        if (line.includes('estimated printing time')) {
          // Parse format like "1h 2m 3s" or "1d 2h 3m 4s"
          const timeMatch = line.split('=')[1].trim();
          printTimeStr = timeMatch;
        }
      }

      // Cleanup temp files
      await fs.unlink(tempFilePath).catch(() => {});
      await fs.unlink(gcodeFilePath).catch(() => {});

      return new Response(JSON.stringify({
        success: true,
        data: {
          volumeCm3,
          weightG,
          printTime: printTimeStr
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (cmdErr: any) {
      // Cleanup on error
      await fs.unlink(tempFilePath).catch(() => {});
      await fs.unlink(gcodeFilePath).catch(() => {});
      
      // Fallback: If slicer is not installed (e.g. local dev environment), return a mocked response
      // so the dev server doesn't break while building the UI.
      if (cmdErr.message.includes('not found') || cmdErr.message.includes('not recognized')) {
        console.warn('CLI Slicer not found locally. Returning mocked estimation data.');
        return new Response(JSON.stringify({
          success: true,
          mocked: true,
          data: {
             volumeCm3: (buffer.length / 1024 / 1024) * 5, // Mocked 5 cm3 per MB
             weightG: (buffer.length / 1024 / 1024) * 6,   // Mocked 6g per MB
             printTime: '1h 30m 0s'
          }
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      throw cmdErr;
    }
  } catch (error: any) {
    console.error('Slicing error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
}
