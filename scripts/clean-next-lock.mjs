#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const lockPath = path.join(process.cwd(), ".next", "dev", "lock");

if (!fs.existsSync(lockPath)) {
  process.exit(0);
}

let lockData;

try {
  const raw = fs.readFileSync(lockPath, "utf8");
  lockData = JSON.parse(raw);
} catch {
  // If lock content is invalid, treat it as stale and remove it.
  fs.rmSync(lockPath, { force: true });
  console.log("[clean-next-lock] Removed malformed lock file.");
  process.exit(0);
}

const pid = Number(lockData?.pid);

if (!Number.isInteger(pid) || pid <= 0) {
  fs.rmSync(lockPath, { force: true });
  console.log("[clean-next-lock] Removed lock file with invalid PID.");
  process.exit(0);
}

try {
  process.kill(pid, 0);
  console.log(`[clean-next-lock] Active lock detected for PID ${pid}. Keeping lock.`);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
    console.log(`[clean-next-lock] PID ${pid} exists but is not signalable. Keeping lock.`);
    process.exit(0);
  }

  fs.rmSync(lockPath, { force: true });
  console.log(`[clean-next-lock] Removed stale lock for missing PID ${pid}.`);
}
