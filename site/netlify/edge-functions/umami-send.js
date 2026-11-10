// Forwards Umami events to Umami Cloud from this domain, so ad blockers don't
// drop them. A plain Netlify rewrite would make every visit look like it came
// from the Netlify server that forwarded it (e.g. Frankfurt), so this passes
// the visitor's IP in x-umami-client-ip, which Umami Cloud reads first. Umami
// uses it to look up country and city and doesn't store it.
const SEND_URL = 'https://gateway.umami.is/api/send';

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  return fetch(SEND_URL, {
    method: 'POST',
    body: request.body,
    headers: {
      'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
      'User-Agent': request.headers.get('User-Agent') ?? '',
      'x-umami-client-ip': context.ip,
    },
  });
};

export const config = { path: '/_v/api/send' };
