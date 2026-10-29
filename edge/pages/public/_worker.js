// Pages project "localedition": every request goes to the product Worker through the APP service binding.
const front = { fetch: (request, env) => env.APP.fetch(request) };
export default front;
