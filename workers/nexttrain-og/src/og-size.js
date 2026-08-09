/**
 * Canonical OG preview size.
 * We render at 2× (2400×1260) so WhatsApp/Facebook downscales look sharper;
 * meta width/height must match the actual PNG pixels.
 */
export const OG_IMAGE_WIDTH = 2400;
export const OG_IMAGE_HEIGHT = 1260;
/** SVG design space (layout coordinates). Scaled up at PNG render time. */
export const OG_DESIGN_WIDTH = 1200;
export const OG_DESIGN_HEIGHT = 630;
