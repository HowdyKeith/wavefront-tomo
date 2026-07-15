// simulation/tomo/diffraction.js -- the law that filtered back-projection is the corner case of.
//
// Everything in this engine's tomography stack rests on the FOURIER SLICE THEOREM: the 1-D transform of a
// projection at angle theta IS a straight LINE through the object's 2-D transform, at that same angle. That is why
// back-projection works at all. (Gated in physicsSuite from v2491 -- it had never been checked, in a dozen rounds
// of building on it.)
//
// AND IT IS ONLY TRUE BECAUSE RAYS ARE ASSUMED TO GO STRAIGHT, which is only true at ZERO WAVELENGTH.
//
// The honest law is the FOURIER DIFFRACTION THEOREM (Wolf 1969; Devaney 1982). A wave scattered off an object does
// not sample its spectrum along a line. It samples along a SEMICIRCLE -- the Ewald arc. For an incident plane wave
// along s0 and a scattered direction s, with k = 2 pi / lambda, the measurement lands at
//
//     K = k (s - s0)
//
// which, as s sweeps, traces a circle of radius k passing through the origin. Not a line. An arc.
//
// AS LAMBDA -> 0 THE ARC FLATTENS INTO THE LINE and you recover the slice theorem. So X-ray CT is not "an
// approximation to" diffraction tomography in a hand-wavy sense: it is its zero-wavelength CORNER, and the
// distance between them is a closed-form number rather than a matter of opinion.
//
// THAT NUMBER IS THE POINT OF THIS FILE. For a measurement at transverse spatial frequency w, the arc's departure
// from the straight line the slice theorem promises is, exactly,
//
//     K_parallel = k (cos(dtheta) - 1) = -(k - sqrt(k^2 - w^2))    ->    approximately  -w^2 / (2k) = -w^2 lambda / (4 pi)
//
// So HOW WRONG IS RAY TOMOGRAPHY? It is wrong by w^2 lambda / (4 pi), and that can be written down before any code
// runs. Same discipline as FDTD's numerical dispersion: not "is the answer right", but "the answer is wrong by
// exactly this much, and here is the arithmetic that says so".
//
// WHY THIS IS NOT AN ACADEMIC EXERCISE HERE. X-rays get away with the limit because their wavelength is picometres
// and w^2 lambda is nothing. WiFi at 2.4 GHz has a wavelength of 12.5 CENTIMETRES.
//
// MEASURED (v2491), at 2.4 GHz, by feature size -- because "w = 2" is a spatial frequency and asking the question
// in frequencies let me quietly test a 3-metre feature and then editorialise about it:
//
//     feature          straight-ray answer is off by
//     a room (3 m)          2.1%    -- fine
//     a doorway (1 m)       6.3%
//     a torso (0.5 m)      12.7%    -- usable with care
//     a laptop (0.25 m)    26.8%    -- badly wrong
//     a fist (0.13 m)      75.4%    -- the correction IS the measurement
//     a phone (0.08 m)     EVANESCENT -- 2.4 GHz cannot report it at all
//
// It degrades SMOOTHLY. There is no threshold where ray tomography "stops working" -- it just becomes more wrong
// than right somewhere around laptop-sized, and by fist-sized it is not an approximation with an error bar. And
// below half a wavelength (6.3 cm here) the arc cannot reach at all: a wave cannot report detail finer than half
// of itself. THAT limit is not a modelling choice; it falls out of |K| <= 2k.
//
// So: you cannot ray-trace WiFi to find anything person-sized, and this engine holding BOTH a real wave solver
// (FDTD, whose Fresnel coefficients fall out to 0.0087 without being told them) and a tomograph is an unusual
// thing to be holding.
"use strict";

const TWO_PI = 2 * Math.PI;

// Where a measurement at transverse frequency w ACTUALLY lands in the object's spectrum, given a wavelength.
// Returns { perp, par }: perp is the frequency the slice theorem thinks it measured; par is the longitudinal
// offset it does not know about. At lambda -> 0, par -> 0 and the arc IS the line.
function ewaldPoint(w, lambda) {
    const k = TWO_PI / lambda;
    if (Math.abs(w) > k) return null;          // evanescent: this frequency cannot be carried by this wavelength
    return { perp: w, par: -(k - Math.sqrt(k * k - w * w)) };
}

// The exact departure of the Ewald arc from the slice theorem's line, at transverse frequency w.
function sliceError(w, lambda) {
    const p = ewaldPoint(w, lambda);
    return p === null ? NaN : Math.abs(p.par);
}

// The small-angle prediction, which is the number worth carrying in your head: w^2 lambda / (4 pi).
function sliceErrorApprox(w, lambda) { return w * w * lambda / (4 * Math.PI); }

// The highest transverse frequency a given wavelength can carry AT ALL. Beyond |K| = 2k the arc cannot reach:
// a wave simply cannot report detail finer than half its own wavelength. This is the diffraction limit, and it
// falls out of the geometry rather than being imposed.
function maxFrequency(lambda) { return 2 * TWO_PI / lambda; }

export { ewaldPoint, sliceError, sliceErrorApprox, maxFrequency, TWO_PI };
