// Pages project "localedition": every request goes to the product Worker through the APP service binding.
//
// The product Worker rate limits by `cf-connecting-ip` and reads nothing else in production (src/server/limits.ts:
// x-forwarded-for is client-controlled). That header must reach it, or every visitor lands in one shared "unknown"
// bucket and the new-workspace limit answers 429 to everyone. So the header is set again, explicitly, on the request
// that goes over the binding, instead of relying on the platform to carry it. tests/fix-a/pages-worker.test.ts pins this;
// confirm it once against the deployed hop (or `opennextjs-cloudflare preview`) before judging.
const front = {
  fetch(request, env) {
    const ip = request.headers.get("cf-connecting-ip");
    if (!ip) return env.APP.fetch(request);
    const headers = new Headers(request.headers);
    headers.set("cf-connecting-ip", ip);
    return env.APP.fetch(new Request(request, { headers }));
  },
};
export default front;
