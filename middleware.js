/* Sends shop subdomains to the renderer: elma.vlipa.dev -> /api/render?slug=elma.

   Point a wildcard record (*.vlipa.dev) at this deployment and add the wildcard
   domain in the Vercel project for the addresses to resolve. */

export const config = {
  matcher: ['/((?!api|assets|_next|favicon|.*\\..*).*)'],
};

const ROOTS = (process.env.PUBLISH_DOMAIN || 'vlipa.dev').split(',').map((d) => d.trim());
const SKIP = new Set(['www', 'app', 'studio', 'api', 'admin', 'docs', 'blog', 'dev', 'staging']);

export default function middleware(request) {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  const root = ROOTS.find((domain) => host.endsWith(`.${domain}`));

  if (!root) return;

  const slug = host.slice(0, -(root.length + 1));
  if (!slug || slug.includes('.') || SKIP.has(slug)) return;

  const url = new URL(request.url);
  url.pathname = '/api/render';
  url.searchParams.set('slug', slug);

  // Rewrite, not redirect: the shop keeps its own address in the bar.
  return new Response(null, { headers: { 'x-middleware-rewrite': url.toString() } });
}
