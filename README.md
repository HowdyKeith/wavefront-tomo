# wavefront-tomo

Diffraction tomography in plain JavaScript, with an FDTD wave solver that **adjudicates its own approximation**.

No native dependencies. No build step. `node test/suite.mjs` and everything below is checked in front of you.

```js
import { bornError, maxPhaseFor, ewaldPoint, maxFrequency } from "wavefront-tomo";
```

## Why this exists

Almost every tomographic reconstruction ever performed rests on the **Born approximation**: the assumption that a
wave passing through an object is barely disturbed by it, so the field *inside* the object can be replaced by the
field that would have been there if the object were absent. That assumption is what makes the problem linear, and
therefore invertible.

It is also obviously false. The object is there.

The useful question is never *"is Born right"* — it isn't — but **"when is it wrong enough to matter?"** That is
normally answered by citing somebody. This package answers it by measurement, because it ships both halves: the
theory, and an FDTD solver that steps Maxwell's equations and has never heard of Born.

```
delta    Born error MEASURED by Maxwell    phi^2/2 PREDICTED beforehand
0.01                0.11%                          0.11%
0.05                2.74%                          2.71%
0.20               41.07%                         40.54%
```

The left column comes from a wave solver with no stake in the outcome. The right column was written down before any
of it ran. They agree to about 1% across a 400-fold range of error, and they part above a phase shift of ~1 rad —
exactly where `phi^2/2` stops being a small-angle expansion. The theory announces its own limit, twice.

## What is actually in here

**The Fourier Slice Theorem** — the law that back-projection *is*. The 1-D transform of a projection at angle θ
equals the 2-D transform of the object along the line at that angle. If it were false, FBP would not be an
approximation; it would be nothing. Checked to 3.3e-6, both transforms by direct summation — no FFT to blame, no
shared code between the two sides.

**And the law it is a corner of.** The slice theorem is only true because rays travel in straight lines, which is
only true at zero wavelength. A real wave samples a **semicircle** — the Ewald arc (Wolf 1969). As λ → 0 the arc
flattens onto the line and you recover FBP exactly. The departure is `w²λ/4π`, which you can write down before any
code runs. X-ray CT is not *approximately* diffraction tomography; it is its **λ = 0 corner**, and the distance
between them is arithmetic.

What that means away from X-rays, at 2.4 GHz (λ = 12.5 cm), by feature size:

| feature | straight-ray answer is off by |
|---|---|
| a room (3 m) | 2.1% — fine |
| a torso (0.5 m) | 12.7% |
| a laptop (0.25 m) | 26.8% — badly wrong |
| a fist (0.13 m) | 75.4% — the correction *is* the measurement |
| a phone (0.08 m) | **evanescent** — 2.4 GHz cannot report it at all |

It degrades *smoothly*. There is no threshold where ray tomography "stops working". And below half a wavelength the
arc cannot reach at all — a wave cannot report detail finer than half of itself. That limit is not imposed here; it
falls out of the geometry, and the suite **derives** it rather than asserting it.

**A metaball phantom with a closed-form shadow.** The line integral of `(1 − r²/R²)³` through a sphere is
`(32/35)·a·R·(1 − c²/R²)^3.5`. Exact, so reconstructions can be scored against truth instead of against a
recorded baseline. (It is also, exactly, the SPH poly6 kernel — the same integral forces both constants.)

**1-D FDTD whose error is closed-form.** `ω = (2/dt)·asin(S·sin(k·dx/2))`. You can predict how wrong the grid will
be before running it. At `S = 1` — the magic step — the dispersion is *identically zero*, and taking a **smaller**
step makes it **worse**, which is the opposite of every intuition about numerics.

## What this solver cannot do

Stated plainly, because it cost three rounds to learn and you should not repeat them:

- **The absorbing boundary only works in vacuum.** It copies its neighbour, which is exact only when the wave moves
  exactly one cell per step. Inside a dielectric it does not, so the boundary becomes a mirror. **A medium must
  never touch the grid edge.**
- **It cannot hold a CW steady state.** The source injects at `Ez[1]` and the boundary is `Ez[0] = Ez[1]` — it
  copies the source cell and feeds the wave back in. Run a continuous source long enough and the field grows without
  bound: fitting a phase after 1200 / 2600 / 5000 / 9000 / 16000 steps of settling gives 1.0% / 1.1% / 80% / 204% /
  263%. It does not converge. It **diverges**.
- **So measure with pulses, differentially.** Send a pulse, time it with the object and without, and take the
  difference at a *fixed* probe. That is the only geometry this solver measures honestly, and it is good to 0.08%.
  Use the pulse's **energy centroid**, not its peak, so the answer is not quantised to whole time steps.

## Verification

Every check in `test/suite.mjs` compares the code to a number derived on paper — an integral, an exact phase, a
defined constant. **There are no recorded baselines**, because a baseline captured from the code under test can only
ever detect *change*, never *wrongness*.

And a green suite proves nothing on its own, so:

```
node tools/sweep.mjs src/em/fdtd1d.js
```

walks the source, finds every numeric literal, and changes each one to see whether anything notices. It has no
theory about which numbers matter, which is the point: **it can find holes the author never thought to look for.**

It found two in this package before release. The speed of light was unguarded — every other electromagnetic check
is a *ratio* (`vp/c`, a reflection coefficient) and `c` divides out of all of them, so the grid could have run 3%
fast forever with every check green. And `maxPhaseFor()` was decoration: called only to build a sentence, never
asserted. Converting it into a real assertion immediately exposed that the claim behind it was too simple — **Born
makes two errors, not one**, and `phi²/2` describes only the first.

A constant that survives a 50% change is not being checked, however healthy the badge looks. Read survivors with
judgement: a default argument or a buffer length *should* survive; a physical constant surviving is a hole.

## Licence

MIT. The physics is public knowledge and belongs to nobody: Yee (1966) for the FDTD scheme, Wolf (1969) for the
Fourier Diffraction Theorem, Devaney (1982) for the inversion, Born & Wolf for the approximation and its limits.
Those are laws and algorithms, not code. The implementation is original. See `LICENSE`.
