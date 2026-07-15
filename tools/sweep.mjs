// tools/sweep.mjs -- are the constants in this package load-bearing, or decoration?
//
// A green test suite proves nothing on its own. A test can pass because the code is right, or because the test
// cannot fail. The only way to tell the difference is to BREAK THE CODE ON PURPOSE and see whether anything
// notices. If a constant can be changed and the suite stays green, that constant is not being checked -- however
// healthy the badge looks.
//
// This walks the source, finds every numeric literal, and perturbs each one. It has no theory about which numbers
// matter, which is the entire point: it can find holes the author never thought to look for. It found one here --
// the speed of light was unguarded, because every other electromagnetic check is a ratio and c divides out.
//
// IT ESCALATES: 3% first, then 50%. A 3% change to a SCALE constant moves the answer 3%; a 3% change to an OFFSET
// moves it by a rounding error. One step size cannot test both, and a tool that cries wolf gets ignored.
//
// READ THE SURVIVORS WITH JUDGEMENT. It cannot tell PHYSICS from PLUMBING. A default argument, a buffer length, or
// an RNG seed SHOULD survive -- the answer must not depend on them. A physical constant surviving is a hole.
//
// Usage: node tools/sweep.mjs src/em/fdtd1d.js [--slice 0,8]
"use strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mutationsFor } from "./scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = path.join(ROOT, "tools", ".sweep-stranded.json");
const FRACS = [0.03, 0.5];

// A finally block does not survive a kill. The marker goes down BEFORE any file is touched, so a killed run is
// recoverable rather than leaving a mutated source tree that looks fine.
function recover() {
    if (!fs.existsSync(MARKER)) return;
    try {
        const s = JSON.parse(fs.readFileSync(MARKER, "utf8"));
        fs.writeFileSync(path.join(ROOT, s.file), s.original);
        fs.unlinkSync(MARKER);
        console.log("[sweep] RECOVERED a stranded mutation in " + s.file + " (a previous run was killed).");
    } catch {}
}
function suiteIsGreen() {
    try { execFileSync(process.execPath, ["test/suite.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore","pipe","pipe"] }); return true; }
    catch { return false; }
}

const file = process.argv[2];
if (!file) { console.log("usage: node tools/sweep.mjs <file> [--slice a,b]"); process.exit(1); }
recover();
const rel = path.relative(ROOT, path.resolve(file));
const full = path.join(ROOT, rel);
const original = fs.readFileSync(full, "utf8");
const byFrac = FRACS.map((fr) => ({ fr, muts: mutationsFor(full, { frac: fr }) }));
const sl = process.argv.includes("--slice") ? process.argv[process.argv.indexOf("--slice")+1].split(",").map(Number) : null;
if (sl) for (const b of byFrac) b.muts = b.muts.slice(sl[0], sl[1]);
const total = byFrac[0].muts.length;

// THE CONTROL, and it is not optional: if the suite is already red, every "caught" below is a lie and this would
// happily report a perfect score.
process.stdout.write("[sweep] control: is the suite green on untouched code? ");
if (!suiteIsGreen()) { console.log("NO -- refusing to produce verdicts."); process.exit(2); }
console.log("yes.\n");
console.log("[sweep] " + rel + ": " + total + " constants, escalating 3% then 50%.\n");

const tryOne = (m) => {
    try {
        fs.writeFileSync(MARKER, JSON.stringify({ file: rel, original }));
        fs.writeFileSync(full, m.mutated);
        return suiteIsGreen();
    } finally {
        fs.writeFileSync(full, original);
        if (fs.readFileSync(full, "utf8") !== original) throw new Error("RESTORE FAILED for " + rel);
        try { fs.unlinkSync(MARKER); } catch {}
    }
};
const holes = [];
for (let i = 0; i < total; i++) {
    const small = byFrac[0].muts[i];
    if (!tryOne(small)) { console.log("   caught at 3%    line " + String(small.line).padStart(4) + "  " + small.was + " -> " + small.now); continue; }
    const big = byFrac[1].muts[i];
    if (!tryOne(big)) { console.log("   caught at 50%   line " + String(big.line).padStart(4) + "  " + big.was + " -> " + big.now + "   (3% was below its noise floor -- fine)"); continue; }
    holes.push(big);
    console.log("   SURVIVED BOTH   line " + String(big.line).padStart(4) + "  " + small.was + " -> " + big.now + "   " + big.context);
}
console.log("\n[sweep] " + (total - holes.length) + "/" + total + " constants are pinned by the suite.");
if (holes.length) {
    console.log("\n   These survived a 50% change. A free parameter SHOULD survive; a physical constant surviving is a hole:");
    for (const h of holes) console.log("      line " + String(h.line).padStart(4) + "  " + h.was + " -> " + h.now + "\n         " + h.context);
}
