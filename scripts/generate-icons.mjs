import sharp from "sharp";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// Dark background (#09090b) with a bold "A" — ALPHACORE brand icon
function makeSvg(size, maskable = false) {
  const padding = maskable ? Math.round(size * 0.15) : Math.round(size * 0.05);
  const innerSize = size - padding * 2;
  const fontSize = Math.round(innerSize * 0.55);
  const cx = size / 2;
  const cy = size / 2;
  const r = maskable ? size / 2 : Math.round(size * 0.18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#09090b"/>
  <text x="${cx}" y="${cy}" dy="0.35em" text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="800" font-size="${fontSize}" fill="#e4e4e7"
        letter-spacing="-0.02em">A</text>
  <text x="${cx}" y="${cy + fontSize * 0.45}" text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="500" font-size="${Math.round(fontSize * 0.18)}" fill="#71717a"
        letter-spacing="0.2em">CORE</text>
</svg>`;
}

const icons = [
  { name: "icon-72.png", size: 72 },
  { name: "icon-96.png", size: 96 },
  { name: "icon-128.png", size: 128 },
  { name: "icon-144.png", size: 144 },
  { name: "icon-152.png", size: 152 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-384.png", size: 384 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-maskable-192.png", size: 192, maskable: true },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size, maskable } of icons) {
  const svg = Buffer.from(makeSvg(size, maskable));
  await sharp(svg).png().toFile(join(outDir, name));
  console.log(`✓ ${name} (${size}x${size})`);
}

// Also copy apple-touch-icon to public root (standard Apple location)
const appleSvg = Buffer.from(makeSvg(180));
await sharp(appleSvg).png().toFile(join(outDir, "..", "apple-touch-icon.png"));
console.log("✓ apple-touch-icon.png → public/");

console.log("\nDone! All icons generated.");
