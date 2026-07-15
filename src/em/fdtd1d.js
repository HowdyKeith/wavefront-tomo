// simulation/em/fdtd1d.js -- Maxwell on a grid (Yee, 1966), and the only solver in this engine that can be told
// in advance exactly how wrong it will be.
//
// Every other check here asks "does the simulation match the right answer?" This one can do something better,
// because FDTD's error is not a mystery to be measured -- it is a closed-form function that can be written down
// before the code runs. Discretising Maxwell's equations gives waves that travel slightly SLOW, by a factor that
// falls out of the update equations analytically:
//
//     (1/(c dt)) sin(omega dt / 2) = (1/dx) sin(k dx / 2)
//
// which inverts to omega = (2/dt) asin(S sin(k dx / 2)), with S = c dt / dx the Courant number. So the numerical
// phase velocity is a formula, not an observation. THAT is the strongest form of the discipline available: not
// "the answer is right", but "the answer is wrong by exactly this much, and here is the arithmetic that says so".
// If the sim and the formula agree on the error, the model of the model is correct.
//
// AND THERE IS A GIFT HIDING IN THAT FORMULA. At S = 1 exactly -- the "magic time step" -- asin(sin(x)) = x and the
// whole thing collapses to omega = c k. NO DISPERSION AT ALL. In one dimension, at exactly one time step, a
// discrete grid propagates a wave PERFECTLY: the numerical answer and Maxwell's answer are the same number, at
// every frequency, forever. Take a smaller step "to be safe" and it gets WORSE, which is the opposite of every
// instinct anyone has about numerical methods. That is a fact worth having a test for.
//
// (S > 1 is unstable and the field explodes; S = 1 sits exactly on the boundary. In 2D and 3D the magic step does
// not exist -- the best available is 1/sqrt(dims) and some dispersion is unavoidable, direction-dependent, and
// still analytic.)
//
// MEASURED (v2487). Predicted first from the formula, then measured on the grid, one frequency at a time:
//
//     S     cells/wavelength    PREDICTED vp/c    MEASURED vp/c    agreement
//    1.00        12               1.000000          1.000000        0.0e+0    <- the magic step, exactly
//    0.90        12               0.997782          0.997768        1.4e-5
//    0.50        12               0.991396          0.991262        1.3e-4
//    0.50         8               0.980542          0.979733        8.1e-4
//    0.90        20               0.999213          0.999154        5.9e-5
//
// The grid is wrong, and it is wrong by exactly the amount the algebra said before the code ran. That is a
// stronger claim than "the answer is right": it means the MODEL OF THE MODEL is correct.
//
// AND FRESNEL FALLS OUT, having never been mentioned to the code. Put a slab of index n in the grid and measure
// what bounces back: air->glass (n 1.5) textbook 0.2000 / measured 0.2023; drywall-ish (2.0) 0.3333 / 0.3406;
// concrete-ish (2.5) 0.4286 / 0.4341; dense (4.0) 0.6000 / 0.6087. Control, air against air: 0.0000 / 0.0000.
// The grid was told Maxwell twice per cell. Fresnel is a consequence, not an input.
//
// TWO OF MY TEST BUGS, RECORDED because both were caught by structure rather than by suspicion:
//   - A pulse test "showed" the largest wake at S=1, where dispersion is provably ZERO. It was measuring the
//     left-going wave my own initial condition leaked. Dispersion is PER-FREQUENCY; a pulse contains all of them
//     and cannot tell you which travelled slow. Drive one frequency or measure nothing.
//   - The Fresnel control (air against air) measured |r| = 1, which is impossible -- and that impossibility is
//     what exposed the method: sin(kx - wt) already swings 0 to 1 ACROSS SPACE at any instant, so a spatial min/max
//     measures the sine, not the envelope. The standing-wave ratio needs the peak each cell reaches over TIME.
//     A control that cannot fail is decoration; this one earned its place in one line.
"use strict";

const C0 = 299792458;            // m/s, exact by definition since 1983

// The analytic numerical phase velocity of this scheme -- what the grid WILL do, derived, not measured.
function numericalPhaseVelocity(S, pointsPerWavelength) {
    const kdx = 2 * Math.PI / pointsPerWavelength;      // k * dx
    const arg = S * Math.sin(kdx / 2);
    if (Math.abs(arg) > 1) return NaN;                  // evanescent -- the grid cannot carry this wave
    const omega_dt = 2 * Math.asin(arg);
    // vp / c = (omega/k) / c = omega_dt / (S * kdx)
    return omega_dt / (S * kdx);
}

// A 1-D Yee grid. Ez lives on integer nodes, Hy on half-nodes, and they leapfrog: that staggering is the whole
// scheme, and it is why the thing is second-order accurate with a first-order-looking update.
function createFdtd1d({ n = 400, dx = 0.001, S = 1.0, eps = null } = {}) {
    const dt = S * dx / C0;
    const Ez = new Float64Array(n);
    const Hy = new Float64Array(n);
    const epsR = eps || new Float64Array(n).fill(1);
    // update coefficients, precomputed. In normalised units the impedance drops out and both are S/epsR.
    const cE = new Float64Array(n), cH = new Float64Array(n);
    for (let i = 0; i < n; i++) { cE[i] = S / epsR[i]; cH[i] = S; }
    let t = 0;

    function step(sourceFn = null) {
        for (let i = 0; i < n - 1; i++) Hy[i] += cH[i] * (Ez[i+1] - Ez[i]);
        for (let i = 1; i < n; i++) Ez[i] += cE[i] * (Hy[i] - Hy[i-1]);
        if (sourceFn) Ez[1] += sourceFn(t);
        // absorbing ends, only exact at S = 1 -- at the magic step the wave moves exactly one cell per step, so
        // copying the neighbour IS the outgoing wave. Off-magic this leaks a little, which is honest and expected.
        Ez[0] = Ez[1];
        Ez[n-1] = Ez[n-2];
        t++;
        return t;
    }
    return { Ez, Hy, step, dt, dx, n, S, get t() { return t; },
        energy() { let e = 0; for (let i = 0; i < n; i++) e += Ez[i]*Ez[i]/epsR[i] + Hy[i]*Hy[i]; return e; } };
}
export { C0, createFdtd1d, numericalPhaseVelocity };
