// simulation/tomo/blobPhantom.js -- the blobulator, X-rayed. Keith's idea, and the round was finding out what it
// takes for a blob to be scannable at all.
//
// A blobulator's idea of a selfie: it casts its own shadows and is rebuilt from them, with nothing simulated
// anywhere -- the shadows are written down in closed form and back-projection has to find the wax from those alone.
//
// GETTING THERE TOOK TWO REAL FAILURES, AND THEY ARE THE INTERESTING PART.
//
// The blobulator's own kernel is r^3/(d^2 + eps). That has a beautiful closed-form shadow -- the integral of
// dt/(t^2+a^2) along a line is exactly pi/a, so one blob casts r^3*pi/sqrt(p^2+eps), verified against brute-force
// integration to 1.1e-11. So the scan looked free.
//
//   FAILURE 1 -- 108% error, FLAT from 24 angles to 180. Flat means systematic, not sampling. The cause: that kernel
//   decays like 1/d^2 and NEVER REACHES ZERO -- one blob's shadow is still 9.4% of its peak ten radii out, falling
//   like 1/p forever. Filtered back-projection requires a COMPACTLY SUPPORTED object: the shadow must finish inside
//   the detector. It never does, so the detector truncates an unfinished shadow, the ramp filter integrates a step
//   at the detector edge, and everything is biased by a constant no number of angles can fix. THE BLOBULATOR AS
//   LITERALLY WRITTEN IS NOT A SCANNABLE OBJECT -- not a bug in the reconstruction, a property of a kernel chosen
//   because it looked like wax.
//
//   FAILURE 2 -- truncate the kernel at a cutoff and the shadow stays exact (it costs one arctan: the chord integral
//   is (2r^3/a)arctan(T/a), verified to 9.6e-14). Error fell 108% -> 10.4%. STILL FLAT. Because truncation trades an
//   infinite tail for a HARD EDGE -- the kernel fell from 37% of its peak straight to zero -- and a step is exactly
//   what a ramp filter rings at. Same Gibbs floor that pins the Shepp-Logan phantom near 14%.
//
// So a blob is scannable only if its kernel is BOTH compactly supported (or FBP is biased) AND smooth at the cutoff
// (or it rings). Wyvill's kernel -- what metaballs have actually used since 1986 -- is both:
//
//     f(d) = A (1 - d^2/R^2)^3   for d < R, else 0
//
// It reaches zero with zero slope. And its shadow is not merely closed-form, it is one term. With c the ray's
// closest approach to the blob centre and u = 1 - c^2/R^2, substituting t = R*sqrt(u)*x collapses the whole chord
// integral onto the standard integral of (1-x^2)^3 over [-1,1] = 32/35:
//
//     shadow = (32/35) * A * R * u^3.5        verified against brute force to 3.8e-14
//
// 3D costs nothing extra, for the same reason the ellipsoid did: the out-of-plane distance just moves into c, so a
// slice of a 3D blob IS a 2D blob and the existing per-slice reconstruction works unmodified.
"use strict";

// blobs: [{x, y, z, r, a}] in roughly [-1,1]^3. r is the support radius; a the amplitude. The skin is where the
// summed field crosses ISO.
const ISO = 1.0;

// the field itself -- exact at a point, no grid
function blobFieldAt(x, y, z, blobs) {
    let s = 0;
    for (const b of blobs) {
        const d2 = (x-b.x)**2 + (y-b.y)**2 + (z-b.z)**2;
        if (d2 >= b.r * b.r) continue;
        const u = 1 - d2 / (b.r * b.r);
        s += b.a * u * u * u;
    }
    return s;
}

// THE EXACT SHADOW of a slice at height z: a ray at angle theta, offset s.
function blobRadonAt(s, theta, z, blobs) {
    const ct = Math.cos(theta), st = Math.sin(theta);
    let acc = 0;
    for (const b of blobs) {
        const perp = b.x * ct + b.y * st - s;         // in-plane distance from the ray to the centre
        const dz = z - b.z;
        const c2 = perp * perp + dz * dz;              // closest approach, in 3D
        if (c2 >= b.r * b.r) continue;                 // the ray misses this blob's support
        const u = 1 - c2 / (b.r * b.r);
        acc += (32 / 35) * b.a * b.r * Math.pow(u, 3.5);
    }
    return acc;
}

// a full analytic sinogram of one slice, in the shape fbp.js already takes
function blobSinogram({ nAngles = 90, nDet = 128, z = 0, blobs }) {
    const ds = 2 / nDet;
    const data = new Float64Array(nAngles * nDet);
    const angles = new Float64Array(nAngles);
    for (let j = 0; j < nAngles; j++) {
        const th = Math.PI * j / nAngles;
        angles[j] = th;
        for (let i = 0; i < nDet; i++) data[j * nDet + i] = blobRadonAt(-1 + (i + 0.5) * ds, th, z, blobs);
    }
    return { data, angles, nAngles, nDet, ds };
}

// a reproducible blob arrangement, so the selfie is the same blobulator every time
function makeBlobs(n = 7, seed = 20260715) {
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const blobs = [];
    for (let i = 0; i < n; i++) blobs.push({
        x: (rnd() - 0.5) * 0.85, y: (rnd() - 0.5) * 0.85, z: (rnd() - 0.5) * 0.75,
        r: 0.46 + rnd() * 0.22,       // support radius -- must keep the whole object inside the [-1,1] scan circle
        a: 1.5 + rnd() * 0.9,          // amplitude -- overlapping blobs must actually cross ISO or there is no skin
    });
    return blobs;
}
export { ISO, blobFieldAt, blobRadonAt, blobSinogram, makeBlobs };
