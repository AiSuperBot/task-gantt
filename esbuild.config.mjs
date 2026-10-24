import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

// Obsidian が提供する依存と Node 標準モジュールは external にする
// Mark Obsidian-provided deps and Node built-ins as external
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  // 翻訳を \uXXXX に逃がさず UTF-8 のまま出す（日中韓露の 1 文字が 6 バイトから 2〜3 バイトに）
  // emit translations as UTF-8 instead of \uXXXX escapes (a CJK or Cyrillic character drops from 6 bytes to 2-3)
  charset: "utf8",
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
