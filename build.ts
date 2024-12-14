import { PromisePool } from "@supercharge/promise-pool";
import findRoot from "find-root";
import fs from "fs";
import { glob } from "glob";
import os from "os";
import path from "path";
import util from "util";
import packageInfo from "./package.json";

const exec = util.promisify(require("child_process").exec);
const outDir = path.join(__dirname, "out");

let hasErrors = false;

async function buildParserWASM(
  name: string,
  { subPath, generate }: { subPath?: string; generate?: boolean } = {}
) {
  const label = subPath ? path.join(name, subPath) : name;
  try {
    let packagePath;
    try {
      packagePath = findRoot(require.resolve(name));
    } catch (_) {
      packagePath = path.join(__dirname, "node_modules", name);
    }
    const cwd = subPath ? path.join(packagePath, subPath) : packagePath;

    const loadWasms = () => glob("*.wasm", { cwd });

    if ((await loadWasms()).length == 0) {
      console.log(`⏳ Building ${label}`);
      if (generate) {
        await exec(`npx tree-sitter generate`, { cwd });
      }
      await exec(`npx tree-sitter build --wasm`, { cwd });
      console.log(`✅ Finished building ${label}`);
    }

    if ((await loadWasms()).length == 0) {
      throw new Error("No WASM files found");
    }
    await exec(`mv *.wasm ${outDir}`, { cwd });
    console.log(`✅ Copied ${label}`);
  } catch (e) {
    console.error(`🔥 Failed to build ${label}:\n`, e);
    hasErrors = true;
  }
}

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}

fs.mkdirSync(outDir);

process.chdir(outDir);

const grammars = Object.keys(packageInfo.devDependencies).filter(
  (n) => n.includes("tree-sitter-") && n !== "tree-sitter-cli"
);

PromisePool.withConcurrency(os.cpus().length)
  .for(grammars)
  .process(async (name) => {
    if (name == "tree-sitter-rescript") {
      await buildParserWASM(name, { generate: true });
    } else if (name == "tree-sitter-ocaml") {
      await buildParserWASM(name, { subPath: "ocaml" });
    } else if (name == "tree-sitter-php") {
      await buildParserWASM(name, { subPath: "php" });
    } else if (name == "tree-sitter-typescript") {
      await buildParserWASM(name, { subPath: "typescript" });
      await buildParserWASM(name, { subPath: "tsx" });
    } else {
      await buildParserWASM(name);
    }
  })
  .then(async () => {
    if (hasErrors) {
      process.exit(1);
    }
    await exec("rm tree-sitter-embedded_template.wasm", { cwd: outDir });
  });
