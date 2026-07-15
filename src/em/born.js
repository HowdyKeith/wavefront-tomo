// simulation/em/born.js -- the theory, so the wave solver can tell us when to stop believing it.
//
// Every tomographic reconstruction in this engine, and very nearly every one in the world, rests on the BORN
// APPROXIMATION: that a wave passing through an object is barely disturbed, so the field INSIDE the object can be
// replaced by the field that would have been there if the object were not. That is what makes the problem linear
// and therefore invertible. It is also, obviously, false -- the object is there.
//
// The question is never "is Born right" (it is not) but "WHEN IS BORN WRONG ENOUGH TO MATTER", and that question
// is usually answered by citation. This engine can do better, because it has BOTH HALVES: an FDTD solver that
// computes the TRUE field by stepping Maxwell's equations with no approximation at all, and the theory below. Run
// them against each other and the answer stops being a rule of thumb and becomes a measurement.
//
// THE 1D CASE, which is exact and therefore worth doing first. A slab of thickness d and relative permittivity
// 1 + delta sits in vacuum. Write the Helmholtz equation as u'' + k^2(1 + delta)u = 0, i.e.
//
//     u'' + k^2 u = -k^2 delta u
//
// and treat the right side as a source. The Born approximation replaces the unknown u on the right with the
// incident wave, which gives, for the transmitted field beyond the slab,
//
//     u ~ e^{ikx} (1 + i k delta d / 2)
//
// And the exact answer -- ignoring the small reflections at each face -- is a pure phase delay:
//
//     u = e^{ikx} e^{i (n-1) k d},   n = sqrt(1 + delta)
//
// SO BORN IS THE FIRST TWO TERMS OF THE EXPONENTIAL. Since n - 1 = sqrt(1+delta) - 1 ~ delta/2 for small delta,
// the Born phase i k delta d / 2 IS the exact phase to first order, and the whole approximation amounts to
// e^{i phi} ~ 1 + i phi. It fails exactly when phi stops being small -- and phi is the PHASE SHIFT ACROSS THE
// OBJECT, which is a thing you can compute before you build anything.
//
// That is the number this file exists to hand back: not "Born is valid for weak scatterers" but "your phase shift
// is 1.3 radians and your amplitude error is therefore 22%".
"use strict";

// The phase shift a wave accumulates crossing the object relative to crossing the same distance of vacuum.
// THE governing quantity. Everything below is a function of it.
function phaseShift(delta, k, d) { return (Math.sqrt(1 + delta) - 1) * k * d; }

// The exact transmitted field through a slab, as a complex {re, im} multiplier on e^{ikx}. Pure phase: no
// absorption, and the face reflections are second order in delta and left to FDTD to reveal.
function exactSlab(delta, k, d) {
    const phi = phaseShift(delta, k, d);
    return { re: Math.cos(phi), im: Math.sin(phi) };
}

// The Born approximation to the same thing: the first two terms of that exponential, arrived at honestly by
// replacing the internal field with the incident one rather than by expanding the answer.
function bornSlab(delta, k, d) {
    return { re: 1, im: k * delta * d / 2 };
}

// How wrong Born is here, as a fraction of the field's own size.
function bornError(delta, k, d) {
    const e = exactSlab(delta, k, d), b = bornSlab(delta, k, d);
    return Math.hypot(e.re - b.re, e.im - b.im);
}

// The useful inverse: how big may the phase shift be before Born's error exceeds a tolerance you can live with?
// From |e^{i phi} - (1 + i phi)| ~ phi^2 / 2, so phi ~ sqrt(2 * tol).
//
// THIS IS A LEADING-ORDER BUDGET AND IT RUNS ABOUT 10% OPTIMISTIC. Measured: ask for 1% and the true error at the
// phase it returns is 1.09%; ask for 5%, get 5.56%; ask for 10%, get 11.2%.
//
// The reason is that BORN MAKES TWO ERRORS AND phi^2/2 ONLY DESCRIBES ONE. The famous one is truncating the
// exponential to 1 + i phi. The quiet one is that Born gets THE PHASE ITSELF slightly wrong: it uses k*delta*d/2,
// while the true phase is (sqrt(1+delta) - 1)*k*d, and sqrt(1+delta) - 1 is only delta/2 to first order. Those two
// diverge by 0.50% at delta = 0.02, 2.44% at 0.1, and 7.01% at 0.3.
//
// So use this as what it is: a fast, honest, slightly conservative-to-quote budget. If you need the real number,
// call bornError() with your actual geometry -- it costs nothing and has no expansion in it.
//
// (This comment exists because tools/sweep.mjs caught the 2 below being unguarded: the test suite called this
// function only to BUILD A SENTENCE, never to assert anything, so the constant could be changed to a 3 and nothing
// blinked. Converting that decoration into a real assertion is what exposed the second error above. A number that
// appears in a report and is checked by nothing is not a measurement.)
function maxPhaseFor(tol) { return Math.sqrt(2 * tol); }

export { phaseShift, exactSlab, bornSlab, bornError, maxPhaseFor };
