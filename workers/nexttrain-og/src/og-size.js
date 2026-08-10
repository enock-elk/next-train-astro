/**
 * Canonical OG preview size.
 * Render above the 1200×630 design space for sharper WhatsApp/Facebook thumbs.
 * 3000×1575 stays under WhatsApp's ~600KB soft cap even on the densest GP sheets.
 */
export const OG_IMAGE_WIDTH = 3000;
export const OG_IMAGE_HEIGHT = 1575;
/** SVG design space (layout coordinates). Scaled up at PNG render time. */
export const OG_DESIGN_WIDTH = 1200;
export const OG_DESIGN_HEIGHT = 630;
