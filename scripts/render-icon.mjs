// Renders assets/logo.svg to PNG.
//
//   npm run icon               writes assets/logo.png at 128 px (the Marketplace icon)
//   npm run icon -- 256 512    also writes icons/logo-256.png and icons/logo-512.png
//
// package.json "icon" must be a PNG, so logo.png is committed; re-run this after editing the SVG.
// Other sizes go to icons/, which is git-ignored and not packaged (.vscodeignore packages every
// PNG under assets/).
import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const svg = await readFile("assets/logo.svg");
const sizes = process.argv.slice(2).map(Number);

for (const size of [128, ...sizes]) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Invalid size: ${size}`);
  }
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } })
    .render()
    .asPng();
  let out = "assets/logo.png";
  if (size !== 128) {
    await mkdir("icons", { recursive: true });
    out = `icons/logo-${size}.png`;
  }
  await writeFile(out, png);
  console.log(`${out} (${size}x${size})`);
}
