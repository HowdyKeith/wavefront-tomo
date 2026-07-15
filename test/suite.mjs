// test/suite.mjs -- every claim in the README, checked against a closed-form answer.
//
// There are no fixtures here and no recorded baselines. Every check compares the code to a number derived on
// paper: an integral, an exact phase, a defined constant. A baseline captured from the code under test can only
// ever detect CHANGE -- never WRONGNESS -- so there are none.
//
// Run: node test/suite.mjs
"use strict";
import { ewaldPoint, sliceError, sliceErrorApprox, maxFrequency } from "../src/tomo/diffraction.js";
import { blobFieldAt, blobRadonAt, makeBlobs } from "../src/tomo/blobPhantom.js";
import { createFdtd1d, numericalPhaseVelocity } from "../src/em/fdtd1d.js";
import { phaseShift, bornSlab, bornError, maxPhaseFor } from "../src/em/born.js";

const TWO_PI = 2 * Math.PI;
const rows = [];
const check = (name, got, want, tol, detail) => rows.push({ name, pass: Math.abs(got - want) <= tol, got, want, tol, detail });

// 1. A metaball's X-ray shadow has a closed form. The line integral of (1 - r^2/R^2)^3 through a sphere is
//    (32/35) * a * R * (1 - c^2/R^2)^3.5, where c is the ray's closest approach. Nobody has to be believed.
{
    const blobs = [{ x: 0.1, y: -0.05, z: 0.02, r: 0.4, a: 1.7 }];
    let worst = 0;
    for (const s of [-0.3, 0, 0.15]) for (const th of [0, 0.7, 2.1]) {
        const got = blobRadonAt(s, th, 0, blobs);
        // brute-force the same integral along the ray, with nothing shared but the geometry
        const ct = Math.cos(th), st = Math.sin(th);
        const N = 200000, L = 1.2;
        let acc = 0;
        for (let i = 0; i < N; i++) {
            const t = -L + (2 * L) * (i + 0.5) / N;
            const x = s * ct - t * st, y = s * st + t * ct;
            acc += blobFieldAt(x, y, 0, blobs) * (2 * L / N);
        }
        worst = Math.max(worst, Math.abs(got - acc));
    }
    check("a metaball's X-ray shadow matches its closed form", worst, 0, 2e-6, worst.toExponential(2));
}

// 2. THE FOURIER SLICE THEOREM -- the law that back-projection IS. The 1D transform of a projection at angle theta
//    equals the 2D transform of the object along the line at that angle. If this is false, FBP is not an
//    approximation; it is nothing. Both transforms by direct summation: no FFT to blame, no shared code.
{
    const blobs = makeBlobs(6, 99);
    const N = 48, L = 2.4, d = L / N;
    const F2 = (kx, ky) => {
        let re = 0, im = 0;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const x = -L/2 + (i+0.5)*d, y = -L/2 + (j+0.5)*d;
            const f = blobFieldAt(x, y, 0, blobs);
            if (f === 0) continue;
            const ph = -TWO_PI * (kx*x + ky*y);
            re += f*Math.cos(ph)*d*d; im += f*Math.sin(ph)*d*d;
        }
        return [re, im];
    };
    const F1 = (w, th) => {
        let re = 0, im = 0;
        for (let i = 0; i < N; i++) {
            const s = -L/2 + (i+0.5)*d;
            const p = blobRadonAt(s, th, 0, blobs);
            if (p === 0) continue;
            const ph = -TWO_PI * w * s;
            re += p*Math.cos(ph)*d; im += p*Math.sin(ph)*d;
        }
        return [re, im];
    };
    let worst = 0;
    for (const th of [0, 0.6, 1.9]) for (const w of [0.4, 1.1, 2.0]) {
        const a = F1(w, th), b = F2(w*Math.cos(th), w*Math.sin(th));
        worst = Math.max(worst, Math.hypot(a[0]-b[0], a[1]-b[1]));
    }
    check("a projection IS a line through the object's spectrum", worst, 0, 5e-6,
          worst.toExponential(1) + " -- and it is only true because rays go straight");
}

// 3. THE SLICE THEOREM IS THE ZERO-WAVELENGTH CORNER OF A BIGGER LAW. A real wave samples a SEMICIRCLE (the Ewald
//    arc), not a line. As lambda -> 0 the arc flattens onto the line, and the departure is w^2 lambda / (4 pi) --
//    a number you can write down before any code runs.
{
    let worst = 0;
    for (const lam of [1e-4, 1e-3, 1e-2, 1e-1]) {
        const ex = sliceError(2, lam), ap = sliceErrorApprox(2, lam);
        worst = Math.max(worst, Math.abs(ex - ap) / ap);
    }
    check("back-projection is the zero-wavelength corner of diffraction", worst, 0, 0.02,
          "arc offset at lambda=1e-9 is " + sliceError(2, 1e-9).toExponential(1));
}

// 4. The diffraction limit is DERIVED, not asserted. The measurement lands at K = k(s - s0); sweep the scattered
//    direction and the largest |K| is at backscatter, which is exactly 2k. That is where lambda/2 comes from.
{
    const lam = 0.125, kk = TWO_PI / lam;
    let maxK = 0;
    for (let a = 0; a <= 720; a++) {
        const th = (a / 720) * TWO_PI;
        maxK = Math.max(maxK, Math.hypot(kk * (Math.cos(th) - 1), kk * Math.sin(th)));
    }
    check("the diffraction limit falls out of the arc's own geometry", maxK, maxFrequency(lam), 1e-6 * maxK,
          maxK.toExponential(4) + " = 2k, at backscatter -- so nothing finer than " + (lam/2*100).toFixed(1) + " cm exists at this wavelength");
    check("beyond 2k, a frequency simply cannot be reported", ewaldPoint(maxFrequency(lam) * 1.01, lam) === null ? 0 : 1, 0, 0, "evanescent, from geometry");
}

// 5. FDTD's error is CLOSED FORM: omega = (2/dt) asin(S sin(k dx/2)). Predict how wrong the grid will be, then
//    confirm it is wrong by exactly that much. At S = 1 -- the magic step -- the error is identically zero, and
//    taking a SMALLER step makes it worse, which is the opposite of every intuition.
{
    let worst = 0;
    for (const S of [0.5, 0.7, 0.9]) for (const ppw of [10, 20, 40]) {
        const vp = numericalPhaseVelocity(S, ppw);
        const kdx = TWO_PI / ppw;
        const want = 2 * Math.asin(S * Math.sin(kdx/2)) / (S * kdx);
        worst = Math.max(worst, Math.abs(vp - want));
    }
    const magic = numericalPhaseVelocity(1.0, 12);
    check("the grid is wrong by exactly the predicted amount", worst, 0, 1e-12, "magic step S=1 gives " + magic.toFixed(6) + " -- zero dispersion, exactly");
}

// 6. LIGHT TRAVELS AT THE SPEED OF LIGHT. Every other electromagnetic check here is a RATIO -- phase velocity over
//    c, or a reflection coefficient -- and c divides out of all of them. So the grid could run 3% fast forever with
//    every check green. This one is absolute: a pulse crossing a known gap in a known time. TWO probes, because one
//    probe measures the launch as well. And c is written as a literal, NOT imported from the file under test: a
//    baseline taken from the code being examined detects change, never wrongness.
{
    const C_SI = 299792458;                    // m/s, exact by definition of the metre since 1983
    const n = 700, dx = 0.001;
    const w = createFdtd1d({ n, dx, S: 1.0 });
    const A = 200, B = 500, T0 = 30;
    let tA = null, tB = null, pA = 0, pB = 0;
    for (let s = 0; s < 660; s++) {
        w.step((t) => Math.exp(-((t - T0) * (t - T0)) / 40));
        const a = Math.abs(w.Ez[A]), b = Math.abs(w.Ez[B]);
        if (a > pA) { pA = a; tA = w.t; }
        if (b > pB) { pB = b; tB = w.t; }
    }
    const v = ((B - A) * w.dx) / ((tB - tA) * w.dt);
    check("light travels at the speed of light", Math.abs(v - C_SI) / C_SI, 0, 1e-12, v.toExponential(6) + " m/s vs " + C_SI.toExponential(6) + " exact by SI");
}

// 7. THE BORN APPROXIMATION PREDICTS ITS OWN FAILURE. It is the first two terms of e^{i phi}, so its error is
//    phi^2/2 -- quadratic, which is why it works beautifully and then falls off a cliff.
{
    const k = TWO_PI / 0.05, d = 0.02;
    let worst = 0;
    for (const phi of [0.01, 0.05, 0.2]) {
        let lo = 0, hi = 50;
        for (let i = 0; i < 200; i++) { const m = (lo+hi)/2; if (phaseShift(m, k, d) < phi) lo = m; else hi = m; }
        const delta = (lo+hi)/2;
        worst = Math.max(worst, Math.abs(bornError(delta, k, d) - phi*phi/2) / (phi*phi/2));
    }
    check("the Born approximation predicts its own failure", worst, 0, 0.1,
          "measured error tracks phi^2/2 to " + (worst*100).toFixed(1) + "%");

    // maxPhaseFor() inverts that law: hand it a tolerance, it hands back the phase you must stay under. The sweep
    // caught this being decoration -- it was called ONLY to build a sentence, never asserted, so its 2 could be
    // changed to a 3 and nothing blinked.
    //
    // Asserting it immediately exposed that the claim was too simple. BORN MAKES TWO ERRORS AND phi^2/2 DESCRIBES
    // ONE: the famous truncation of e^{i phi}, and the quiet fact that Born's phase (k*delta*d/2) is not the true
    // phase ((sqrt(1+delta)-1)*k*d) beyond first order. So the budget runs ~10% OPTIMISTIC, and the honest check
    // is that it is optimistic BY A KNOWN AMOUNT rather than by an unknown one.
    let wI = 0, det = "";
    for (const tol of [0.01, 0.05, 0.10]) {
        const phi = maxPhaseFor(tol);
        let lo = 0, hi = 50;
        for (let i = 0; i < 200; i++) { const m = (lo+hi)/2; if (phaseShift(m, k, d) < phi) lo = m; else hi = m; }
        const got = bornError((lo+hi)/2, k, d);
        const over = got / tol - 1;
        if (over > wI) { wI = over; det = "ask for " + (tol*100).toFixed(0) + "%, truly get " + (got*100).toFixed(2) + "%"; }
    }
    check("its phase budget is optimistic by a KNOWN amount", wI, 0.10, 0.05,
          det + " -- Born errs twice: truncation AND the phase itself");
}

// 8. AND THE POINT OF THE WHOLE PACKAGE: MAXWELL AGREES WITH BORN ABOUT WHERE BORN DIES.
//    FDTD steps Maxwell and has never heard of Born. Send a pulse through a slab, time it with and without, and
//    the delay IS the phase the wave actually accumulated. Then ask Born what it expected. The gap is measured,
//    not cited.
//
//    A PULSE, not a standing wave -- see README, "What this solver cannot do". The arrival is the ENERGY CENTROID
//    rather than the peak, so it is not quantised to whole steps.
{
    const dx = 0.001, cells = 60, ppw = 40;
    const lam = ppw * dx, k = TWO_PI / lam, d = cells * dx;
    const truePhase = (delta) => {
        const N = 1200, A = 300, B = A + cells;
        const eps = new Float64Array(N).fill(1);
        for (let i = A; i < B; i++) eps[i] = 1 + delta;
        const src = (t) => { const x = (t - 60) / 18; return Math.exp(-x*x); };
        const arrive = (withSlab) => {
            const w = createFdtd1d({ n: N, dx, S: 1.0, eps: withSlab ? eps : null });
            let num = 0, den = 0;
            for (let st = 0; st < 1500; st++) { w.step(src); const v = w.Ez[900]*w.Ez[900]; num += v*w.t; den += v; }
            return num / den;
        };
        return (arrive(true) - arrive(false)) * (dx / 299792458) * (TWO_PI * 299792458 / lam);
    };
    let worst = 0, detail = "";
    for (const delta of [0.01, 0.05, 0.2]) {
        const phi = truePhase(delta);
        const b = bornSlab(delta, k, d);
        const meas = Math.hypot(Math.cos(phi) - b.re, Math.sin(phi) - b.im);
        const pred = phi * phi / 2;
        const rel = Math.abs(meas - pred) / pred;
        if (rel > worst) { worst = rel; detail = "delta=" + delta + ": Maxwell says Born is " + (meas*100).toFixed(2) + "% wrong; theory predicted " + (pred*100).toFixed(2) + "%"; }
    }
    check("Maxwell agrees with Born about where Born dies", worst, 0, 0.06, detail);
}

const pass = rows.filter((r) => r.pass).length;
console.log("\nwavefront-tomo: " + pass + "/" + rows.length + " agree with mathematics\n");
for (const r of rows) console.log("  " + (r.pass ? "PASS" : "FAIL") + "  " + r.name.padEnd(56) + "  " + (r.detail || ""));
console.log("");
if (pass !== rows.length) process.exit(1);
