import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();
const localCandidates =
  process.platform === "win32"
    ? [
        join(
          projectRoot,
          "services",
          "agent",
          ".venv",
          "Scripts",
          "python.exe",
        ),
      ]
    : [
        join(
          projectRoot,
          "services",
          "agent",
          ".venv",
          "bin",
          "python",
        ),
      ];
const candidates = [
  ...localCandidates.filter((candidate) => existsSync(candidate)),
  process.platform === "win32" ? "python" : "python3",
  "python",
];

let lastError;
for (const executable of candidates) {
  try {
    const exitCode = await run(executable, process.argv.slice(2));
    process.exitCode = exitCode;
    break;
  } catch (error) {
    lastError = error;
  }
}

if (process.exitCode === undefined) {
  throw lastError ?? new Error("No Python interpreter was found.");
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Python terminated by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
