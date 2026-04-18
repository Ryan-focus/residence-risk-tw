// Copy Leaflet's marker icons from node_modules into /public/leaflet so the
// static export can serve them from same-origin instead of unpkg.com.
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "node_modules", "leaflet", "dist", "images");
const DEST = join(__dirname, "..", "public", "leaflet");

if (!existsSync(SRC)) {
  console.warn(
    `[copy-leaflet-assets] ${SRC} does not exist; skipping (leaflet not installed yet).`,
  );
  process.exit(0);
}

await mkdir(DEST, { recursive: true });
const files = await readdir(SRC);
for (const file of files) {
  if (!/\.(png|svg)$/.test(file)) continue;
  await copyFile(join(SRC, file), join(DEST, file));
}
console.log(`[copy-leaflet-assets] copied ${files.length} assets to ${DEST}`);
