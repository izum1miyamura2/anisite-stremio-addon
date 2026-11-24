// Spins up a fake anime site + the addon, then walks search -> meta -> stream.
import express from 'express';
import { spawn } from 'node:child_process';

const site = express();
site.get('/search', (_, r) => r.send(`<div class="film-list">
  <div class="item"><a href="/anime/demo"><img src="/p.jpg"><span class="name">Demo Anime</span></a></div></div>`));
site.get('/anime/demo', (_, r) => r.send(`<h1 class="title">Demo Anime</h1><div class="synopsis">Test show</div>
  <div class="episode-list"><a href="/watch/demo/1" data-number="1" title="Pilot">1</a><a href="/watch/demo/2" data-number="2">2</a></div>`));
site.get('/watch/demo/:n', (_, r) => r.send(`<iframe src="http://127.0.0.1:7101/embed/${_.params.n}"></iframe>`));
site.get('/embed/:n', (_, r) => r.send(`<script>var f={"file":"https:\\/\\/cdn.example\\/ep${_.params.n}\\/master.m3u8"}</script>`));
const s = site.listen(7101);

const provider = {
  name: 'Mock', baseUrl: 'http://127.0.0.1:7101',
  search: { url: '{base}/search?keyword={query}', item: '.film-list .item', title: '.name', link: 'a@href', poster: 'img@src' },
  show: { title: 'h1.title', description: '.synopsis', episode: '.episode-list a', episodeLink: '@href', episodeNumber: '@data-number', episodeTitle: '@title' },
};
const cfg = Buffer.from(JSON.stringify({ provider })).toString('base64url');

const addon = spawn('node', ['src/server.js'], { env: { ...process.env, PORT: 7102 }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const get = async (p) => (await fetch(`http://127.0.0.1:7102/${cfg}${p}`)).json();

try {
  const man = await get('/manifest.json');
  console.log('manifest:', man.name);
  const cat = await get('/catalog/series/anisite-search/search=demo.json');
  console.log('search:', cat.metas.map((m) => m.name));
  const meta = await get(`/meta/series/${cat.metas[0].id}.json`);
  console.log('episodes:', meta.meta.videos.map((v) => `${v.episode} ${v.title}`));
  const st = await get(`/stream/series/${meta.meta.videos[1].id}.json`);
  console.log('streams:', st.streams.map((x) => `${x.title} ${x.url} (ref ${x.behaviorHints.proxyHeaders.request.Referer})`));
  const ok = st.streams[0]?.url === 'https://cdn.example/ep2/master.m3u8';
  console.log(ok ? 'PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
} finally { addon.kill(); s.close(); }
