#!/usr/bin/env node

// A personal or corporate mirror can leak into package-lock.json after
// `npm update`/`npm install`; only the public registry belongs in the repo.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lock = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package-lock.json"), "utf8"),
);
const offenders = Object.entries(lock.packages || {})
  .filter(
    ([, pkg]) =>
      typeof pkg.resolved === "string" &&
      !pkg.resolved.startsWith("https://registry.npmjs.org/"),
  )
  .map(([name]) => name);

assert.deepStrictEqual(
  offenders,
  [],
  `package-lock.json resolves from a non-public registry: ${offenders.slice(0, 5).join(", ")}`,
);
console.log("PASS package-lock.json resolves only from registry.npmjs.org");
