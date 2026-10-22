// Tauri needs real binary icon files (icon.ico on Windows, icon.icns on
// macOS, icon.png on Linux), but binaries don't belong in every clone's
// way — so the repo stores them base64-encoded under
// src-tauri/icons/base64/ and this script materializes them on first run.
// It runs automatically via the `pretauri` npm hook before `npm run tauri`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const iconsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "icons",
);
const base64Dir = join(iconsDir, "base64");

for (const name of ["icon.png", "icon.ico", "icon.icns"]) {
  const target = join(iconsDir, name);
  const source = join(base64Dir, `${name}.b64`);
  if (!existsSync(target) && existsSync(source)) {
    const data = Buffer.from(
      readFileSync(source, "utf8").replace(/\s+/g, ""),
      "base64",
    );
    writeFileSync(target, data);
    console.log(`[icons] generated src-tauri/icons/${name}`);
  }
}
