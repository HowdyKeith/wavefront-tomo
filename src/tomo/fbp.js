// simulation/tomo/fbp.js -- filtered back-projection. Projections in, volume out.
//
// This is the whole of tomographic reconstruction in about a hundred lines, and it is one of the genuinely beautiful
// results in applied mathematics: smear every shadow back across the picture and you get mud, but smear back a
// *correctly filtered* shadow and you get the object, exactly, in the limit. The filter is the entire trick.
//
// WHY THE RAMP. Back-projection alone over-counts low frequencies -- every ray through the origin passes through the
// centre, so the centre accumulates from every angle while the edges do not. In Fourier terms the samples pile up
// near the origin with density 1/|w|, so the fix is to multiply by |w| before smearing: the ramp filter. Ram-Lak is
// that ramp, and it is applied here in the spatial domain as a convolution, because the discrete kernel is closed
// form and that avoids dragging an FFT in to do something a hundred multiplies can do exactly:
//   h[0] = 1/(4 ds^2)   |   h[even] = 0   |   h[odd] = -1/(n^2 pi^2 ds^2)
//
// Nothing here is ported. The reference it gets judged against (simulation/tomo/phantom.js) is analytic and was
// checked against a brute-force line integral BEFORE this file was written, so the only error measured below is this
// code's own.
"use strict";

function ramLak(nDet, ds) {
    const half = nDet;                      // enough taps to cover any overlap
    const h = new Float64Array(2 * half + 1);
    for (let n = -half; n <= half; n++) {
        let v;
        if (n === 0) v = 1 / (4 * ds * ds);
        else if (n % 2 === 0) v = 0;
        else v = -1 / (n * n * Math.PI * Math.PI * ds * ds);
        h[n + half] = v;
    }
    return { h, half };
}

function filterSinogram(sino) {
    const { data, nAngles, nDet, ds } = sino;
    const { h, half } = ramLak(nDet, ds);
    const out = new Float64Array(nAngles * nDet);
    for (let j = 0; j < nAngles; j++) {
        const row = j * nDet;
        for (let i = 0; i < nDet; i++) {
            let acc = 0;
            for (let k = 0; k < nDet; k++) acc += data[row + k] * h[i - k + half];
            out[row + i] = acc * ds;
        }
    }
    return out;
}

// smear each filtered projection back across the image, along the direction it was taken from
function backproject(filtered, sino, n) {
    const { angles, nAngles, nDet } = sino;
    const img = new Float64Array(n * n);
    for (let j = 0; j < nAngles; j++) {
        const th = angles[j], ct = Math.cos(th), st = Math.sin(th), row = j * nDet;
        for (let py = 0; py < n; py++) {
            const y = -1 + (2 * (py + 0.5)) / n;
            for (let px = 0; px < n; px++) {
                const x = -1 + (2 * (px + 0.5)) / n;
                const s = x * ct + y * st;                  // where this pixel lands on this detector
                const fi = (s + 1) * nDet / 2 - 0.5;        // detector coordinate
                const i0 = Math.floor(fi);
                if (i0 < 0 || i0 + 1 >= nDet) continue;
                const w = fi - i0;                          // linear interpolation between bins
                img[py * n + px] += filtered[row + i0] * (1 - w) + filtered[row + i0 + 1] * w;
            }
        }
    }
    const scale = Math.PI / nAngles;
    for (let k = 0; k < img.length; k++) img[k] *= scale;
    return img;
}

function reconstruct(sino, n) { return backproject(filterSinogram(sino), sino, n); }
export { ramLak, filterSinogram, backproject, reconstruct };
