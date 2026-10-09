import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const styles = readdirSync(assetsDir)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(join(assetsDir, file), "utf8"))
  .join("\n");

const checks = [
  [
    "Manager-only 27px rule must not affect POS",
    /body:not\(\.oc11-pos-mode\)\s*\.ant-btn:not\(\.ant-btn-link\):not\(\.sidebar-toggle\)\s*\{[^}]*\bheight\s*:\s*27px/
  ],
  [
    "POS order action buttons remain 56px high",
    /\.pos-create-actions\s*>\s*\.ant-btn\s*\{[^}]*\bheight\s*:\s*56px/
  ],
  [
    "POS quantity plus/minus buttons remain 44px high",
    /\.pos-line-qty button\s*\{[^}]*\bheight\s*:\s*44px/
  ],
  [
    "POS occupied table action buttons remain 60px high",
    /\.pos-table-actions\s+\.ant-btn\s*\{[^}]*\bheight\s*:\s*60px/
  ]
];

for (const [label, pattern] of checks) {
  if (!pattern.test(styles)) {
    throw new Error("POS CSS regression: " + label);
  }
}
const entry = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
if (!entry.includes('document.body.classList.toggle("oc11-pos-mode", mode === "pos")')) {
  throw new Error("POS mode flag is missing from the app entrypoint");
}
process.stdout.write("POS CSS size guards passed.\n");
