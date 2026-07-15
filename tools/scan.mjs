// tools/scan.mjs -- find every numeric literal a suite could be asked about.
//
// mutate.mjs runs ten mutations and catches all ten. That number is worth exactly as much as its weakest
// assumption, which is me: I hand-picked those ten, and nine were things I had just built or just fixed. A
// hand-picked mutation set measures the AUTHOR'S IMAGINATION, not the gate. It is the same trap as every control
// in this engine that was designed to pass -- I chose the ways in which the code might be wrong, so I could only
// discover the wrongness I had already thought of.
//
// So: stop choosing. Walk the source, find every numeric literal, and perturb each one mechanically. The machine
// has no theory about which constants matter, which is the entire point. A constant whose value can be changed
// without any gate noticing is a constant nothing is checking -- and unlike my ten, this can surprise me.
//
// WHAT IT DELIBERATELY SKIPS, and why each is not a cop-out:
//   - 0 and 1: perturbing them usually breaks syntax-level intent (indices, flags, identity elements) rather than
//     physics, and the resulting noise would drown the signal.
//   - array indices [0] [1] [2]: xyz, not physics.
//   - anything in a comment: not code.
// Everything else is fair game, including constants I would never have thought to question, which is the point.
"use strict";
import fs from "node:fs";
import path from "node:path";

// Find numeric literals that are plausibly PHYSICS rather than plumbing.
function findConstants(src) {
    const out = [];
    const lines = src.split("\n");
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const code = line.split("//")[0];                      // comments are not code
        if (!code.trim()) continue;
        const re = /(?<![\w.$])(\d+\.\d+|\d+)(?![\w.])/g;
        let m;
        while ((m = re.exec(code)) !== null) {
            const val = Number(m[1]);
            if (val === 0 || val === 1) continue;              // identity/flag noise
            const before = code.slice(Math.max(0, m.index - 1), m.index);
            if (before === "[") continue;                      // an index, not a quantity
            out.push({ line: li + 1, col: m.index, text: m[1], value: val, context: code.trim().slice(0, 68) });
        }
    }
    return out;
}

// Perturb by a relative amount that is small enough to be a plausible typo and large enough that any gate
// checking the quantity MUST see it.
function perturb(text, frac) {
    const v = Number(text);
    const nv = v * (1 + frac);
    // keep the literal shape recognisable so the replacement is unambiguous in the source
    return String(Number(nv.toPrecision(12)));
}

function mutationsFor(file, { frac = 0.03 } = {}) {
    const src = fs.readFileSync(file, "utf8");
    const consts = findConstants(src);
    const out = [];
    for (const c of consts) {
        const lines = src.split("\n");
        const line = lines[c.line - 1];
        // replace THIS occurrence only, by rebuilding the exact line
        const newLine = line.slice(0, c.col) + perturb(c.text, frac) + line.slice(c.col + c.text.length);
        if (newLine === line) continue;
        const mutated = [...lines.slice(0, c.line - 1), newLine, ...lines.slice(c.line)].join("\n");
        out.push({ file, line: c.line, was: c.text, now: perturb(c.text, frac), context: c.context, mutated });
    }
    return out;
}
export { findConstants, mutationsFor };

if (import.meta.url === `file://${process.argv[1]}`) {
    const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    for (const f of files) {
        const ms = mutationsFor(f);
        console.log(f + ": " + ms.length + " numeric constants a gate could be asked about");
        for (const m of ms.slice(0, 6)) console.log("   line " + String(m.line).padStart(4) + "  " + m.was + " -> " + m.now + "    " + m.context);
        if (ms.length > 6) console.log("   ... and " + (ms.length - 6) + " more");
    }
}
