/**
 * Stub only. Not routed, not in deploy workflows.
 * Later this Worker will serve baked alert posters from R2 at /img/alerts/*.
 * See docs/R2-AND-TRIP-PLANS.md.
 */
export default {
  async fetch() {
    return new Response('nexttrain-img is not deployed yet', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
