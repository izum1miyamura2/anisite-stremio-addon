// Auto-mode test: three mock sites with different markup, only the URL is given.
import express from 'express';
import { spawn } from 'node:child_process';

const header = (logo) => `<header><a href="/"><img src="/logo.png" alt="${logo}"></a>
  <nav><a href="/genres">Genres</a><a href="/top">Top</a></nav></header>`;
const shows = ['One Piece', 'One Punch Man', 'Sakamoto Days'];
const match = (q) => shows.filter((s) => s.toLowerCase().includes(String(q).toLowerCase()));
const slug = (s) => s.toLowerCase().replace(/\s+/g, '-');
const servers = [];
const start = (port, setup) => { const a = express(); setup(a); servers.push(a.listen(port)); };

// Site A: <form> search, card grid, ?ep= links, iframe player with escaped JSON
start(7201, (a) => {
  a.get('/', (_, r) => r.send(`${header('A')}<form action="/filter" method="get"><input name="keyword"><input type="hidden" name="type" value="all"></form>`));
  a.get('/filter', (q, r) => r.send(header('A') + match(q.query.keyword).map((s) => `<div class="flw-item">
    <div class="film-poster"><img data-src="/img/${slug(s)}.jpg" src="/lazy.gif"></div>
    <h3 class="film-name"><a href="/anime/${slug(s)}">${s}</a></h3></div>`).join('')));
  a.get('/anime/:s', (q, r) => r.send(`<head><meta property="og:title" content="${q.params.s} | SiteA">
    <meta property="og:image" content="/img/${q.params.s}.jpg"><meta property="og:description" content="Desc A"></head>
    ${header('A')}<ul class="ep-list">${[1, 2, 3].map((n) => `<li><a href="/watch/${q.params.s}?ep=${n}">${n}</a></li>`).join('')}</ul>
    <div class="related"><a href="/anime/other"><img src="/x.jpg">Other</a></div>`));
  a.get('/watch/:s', (q, r) => r.send(`<iframe src="http://127.0.0.1:7201/embed/${q.query.ep}"></iframe>`));
  a.get('/embed/:n', (q, r) => r.send(`<script>jwplayer().setup({"sources":[{"file":"https:\\/\\/cdn.a\\/e${q.params.n}.m3u8"}]})</script>`));
});

// Site B: OpenSearch descriptor, <article> cards with title attr, "Episode N" text, direct <video>
start(7202, (a) => {
  a.get('/', (_, r) => r.send(`<head><link rel="search" type="application/opensearchdescription+xml" href="/os.xml"></head>${header('B')}`));
  a.get('/os.xml', (_, r) => r.type('xml').send(`<OpenSearchDescription><Url type="text/html" template="http://127.0.0.1:7202/find/{searchTerms}"/></OpenSearchDescription>`));
  a.get('/find/:q', (q, r) => r.send(header('B') + match(q.params.q).map((s) => `<article class="post">
    <a href="/series/${slug(s)}/" title="${s}"><img src="/c/${slug(s)}.webp"></a></article>`).join('')));
  a.get('/series/:s/', (q, r) => r.send(`<h1>${q.params.s}</h1>${header('B')}
    <div class="eps">${[1, 2].map((n) => `<a class="ep" href="/v/${q.params.s}/${n}">Episode ${n}</a>`).join('')}</div>`));
  a.get('/v/:s/:n', (q, r) => r.send(`<video><source src="/media/${q.params.s}-${q.params.n}.mp4"></video>`));
});

// Site C: no form, no OpenSearch (WordPress-style ?s=), newest-first episode list, /ep-N slugs
start(7203, (a) => {
  a.get('/', (q, r) => {
    if (!q.query.s) return r.send(header('C') + '<p>Welcome</p>');
    r.send(header('C') + '<div class="list">' + match(q.query.s).map((s) => `<div class="bs"><div class="bsx">
      <a href="/anime/${slug(s)}/"><div class="limit"><img src="/t/${slug(s)}.jpg" alt="${s}"></div><div class="tt">${s}</div></a></div></div>`).join('') + '</div>');
  });
  a.get('/anime/:s/', (q, r) => r.send(`<title>${q.params.s}</title>${header('C')}
    <div class="eplister"><ul>${[12, 11, 10].map((n) => `<li><a href="/${q.params.s}-ep-${n}/"><div class="epl-num">${n}</div><div class="epl-title">Title ${n}</div></a></li>`).join('')}</ul></div>`));
  a.get('/:ep/', (q, r) => r.send(`<script>var src = "https://cdn.c/${q.params.ep}/index.m3u8?token=abc";</script>`));
});

const addon = spawn('node', ['src/server.js'], { env: { ...process.env, PORT: 7204 }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const cases = [
  ['127.0.0.1:7201', 'one piece', 'https://cdn.a/e2.m3u8'],
  ['http://127.0.0.1:7202', 'sakamoto', 'http://127.0.0.1:7202/media/sakamoto-days-2.mp4'],
  ['http://127.0.0.1:7203/', 'punch', 'https://cdn.c/one-punch-man-ep-11/index.m3u8?token=abc'],
];
let failed = 0;
for (const [site, query, expect] of cases) {
  const site2 = site.startsWith('http') ? site : 'http://' + site;
  const cfg = Buffer.from(JSON.stringify({ site: site2 })).toString('base64url');
  const get = async (p) => (await fetch(`http://127.0.0.1:7204/${cfg}${p}`)).json();
  const cat = await get(`/catalog/series/anisite-search/search=${encodeURIComponent(query)}.json`);
  const meta = await get(`/meta/series/${cat.metas[0]?.id}.json`);
  const vids = meta.meta?.videos || [];
  const st = await get(`/stream/series/${vids[1]?.id}.json`);
  const ok = st.streams?.[0]?.url === expect;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${site}\n  search: ${cat.metas.map((m) => `${m.name} [${m.poster?.split('/').pop()}]`).join(', ')}` +
    `\n  show: ${meta.meta?.name} | eps: ${vids.map((v) => `${v.episode}${v.title.startsWith('Episode') ? '' : ':' + v.title}`).join(', ')}` +
    `\n  stream(ep2): ${st.streams?.map((s) => s.url).join(', ')}`);
}
addon.kill(); servers.forEach((s) => s.close());
process.exitCode = failed ? 1 : 0;
