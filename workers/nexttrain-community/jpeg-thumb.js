/**
 * Very small JPEG for a download preview. The full file is not returned.
 */
import jpeg from 'jpeg-js';

function sampleThumb(decoded, edge) {
    const width = decoded.width;
    const height = decoded.height;
    const scale = edge / Math.max(width, height, 1);
    const tw = Math.max(1, Math.round(width * Math.min(1, scale)));
    const th = Math.max(1, Math.round(height * Math.min(1, scale)));
    const src = decoded.data;
    const out = new Uint8Array(tw * th * 4);
    for (let y = 0; y < th; y += 1) {
        const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / th));
        for (let x = 0; x < tw; x += 1) {
            const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / tw));
            const from = (sy * width + sx) * 4;
            const to = (y * tw + x) * 4;
            out[to] = src[from];
            out[to + 1] = src[from + 1];
            out[to + 2] = src[from + 2];
            out[to + 3] = 255;
        }
    }
    return { data: out, width: tw, height: th };
}

/** @returns {Uint8Array|null} */
export function jpegThumbnail(bytes, edge = 24, quality = 45) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
    let decoded;
    try {
        decoded = jpeg.decode(input, {
            useTArray: true,
            formatAsRGBA: true,
            tolerantDecoding: true,
            maxResolutionInMP: 24,
            maxMemoryUsageInMB: 80,
        });
    } catch {
        return null;
    }
    if (!decoded?.data || !decoded.width || !decoded.height) return null;
    let encoded;
    try {
        encoded = jpeg.encode(sampleThumb(decoded, edge), quality);
    } catch {
        return null;
    }
    const raw = encoded?.data;
    if (!raw || !raw.length) return null;
    const out = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (out.length < 4 || out[0] !== 0xff || out[1] !== 0xd8) return null;
    if (out.length > 12000) return null;
    return out;
}
