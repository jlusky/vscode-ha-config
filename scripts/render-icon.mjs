// Renders the SVG sources in assets/ to PNG.
//
//   npm run icon               writes assets/logo.png (128 px, the Marketplace icon)
//                              and assets/header.png (the README banner, at 2x)
//   npm run icon -- 256 512    also writes icons/logo-256.png and icons/logo-512.png
//
// The Marketplace needs a PNG icon and PNG README images, so the PNGs are committed;
// re-run this after editing an SVG. Extra sizes go to icons/, which is git-ignored and
// not packaged (.vscodeignore packages every PNG under assets/).
import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";

async function render(src, out, width) {
  const svg = await readFile(src);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng();
  await writeFile(out, png);
  console.log(`${out} (${width} px wide)`);
}

const sizes = process.argv.slice(2).map(Number);
for (const size of sizes) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Invalid size: ${size}`);
  }
}

await render("assets/logo.svg", "assets/logo.png", 128);
await render("assets/header.svg", "assets/header.png", 1440);

if (sizes.length > 0) {
  await mkdir("icons", { recursive: true });
}
for (const size of sizes) {
  await render("assets/logo.svg", `icons/logo-${size}.png`, size);
}
