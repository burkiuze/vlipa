/* A dependency-free endpoint for checking that functions run at all.
   GET /api/health -> {"ok":true,...}. Handy when the site itself looks broken:
   if this answers, hosting and functions are fine and the problem is elsewhere. */

export default async () => {
  return new Response(JSON.stringify({
    ok: true,
    service: 'vlipa',
    time: new Date().toISOString(),
    node: typeof process !== 'undefined' ? process.version : 'unknown'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};
