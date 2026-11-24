import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jsonProvider, b64 } from './engine.js';
import { autoProvider } from './auto.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROVIDERS = path.join(ROOT, 'providers');
const PORT = process.env.PORT || 7000;
const PREFIX = 'anisite';

// ---------- provider loading ----------
function listPresets() {
  return fs.readdirSync(PROVIDERS)
    .filter((f) => /\.(json|js)$/.test(f) && !f.startsWith('_'))
    .map((f) => f.replace(/\.(json|js)$/, ''));
}

async function loadProvider(cfg) {
  // cfg: { preset: "name" } or { provider: { ...inline json... } }
  if (cfg?.provider) return jsonProvider(cfg.provider);
  if (cfg?.site) return autoProvider(cfg.site);
  const name = cfg?.preset || process.env.DEFAULT_PRESET || listPresets()[0];
  if (!name || !/^[\w-]+$/.test(name)) throw new Error('No provider configured');
  const js = path.join(PROVIDERS, name + '.js');
  if (fs.existsSync(js)) return (await import(pathToFileURL(js).href)).default;
  return jsonProvider(JSON.parse(fs.readFileSync(path.join(PROVIDERS, name + '.json'), 'utf8')));
}

function parseConfig(s) {
  if (!s) return {};
  try { return JSON.parse(b64.dec(s)); } catch { return {}; }
}

// ---------- app ----------
const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});
app.use(express.static(path.join(ROOT, 'public')));

app.get(['/', '/configure', '/:config/configure'], (_, res) => res.sendFile(path.join(ROOT, 'public/configure.html')));
app.get('/presets.json', (_, res) => res.json(listPresets()));

const wrap = (fn) => async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'max-age=600');
    res.json(await fn(req, parseConfig(req.params.config)));
  } catch (e) {
    console.error(req.path, e.message);
    res.json({ metas: [], streams: [], meta: null });
  }
};

app.get(['/manifest.json', '/:config/manifest.json'], wrap(async (req, cfg) => {
  const host = cfg.site ? cfg.site.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : null;
  const label = cfg.provider?.name || host || cfg.preset || 'not configured';
  return {
    id: 'community.anisite.' + b64.enc(label).slice(0, 16),
    version: '1.0.0',
    name: `AniSite (${label})`,
    description: 'Stream anime from a website you choose. Reconfigure to switch sites.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    idPrefixes: [PREFIX + ':'],
    catalogs: [{
      type: 'series', id: 'anisite-search', name: `AniSite: ${label}`,
      extra: [{ name: 'search', isRequired: true }],
    }],
    behaviorHints: { configurable: true, configurationRequired: !req.params.config },
  };
}));

app.get(['/catalog/:type/:id/:extra.json', '/:config/catalog/:type/:id/:extra.json'], wrap(async (req, cfg) => {
  const query = new URLSearchParams(req.params.extra).get('search');
  if (!query) return { metas: [] };
  const p = await loadProvider(cfg);
  const results = await p.search(query);
  return {
    metas: results.map((r) => ({
      id: `${PREFIX}:${b64.enc(r.url)}`, type: 'series', name: r.name, poster: r.poster,
    })),
  };
}));

app.get(['/meta/:type/:id.json', '/:config/meta/:type/:id.json'], wrap(async (req, cfg) => {
  const [, showB64] = req.params.id.split(':');
  const p = await loadProvider(cfg);
  const m = await p.meta(b64.dec(showB64));
  return {
    meta: {
      id: req.params.id, type: 'series', name: m.name, poster: m.poster, background: m.poster,
      description: m.description,
      videos: m.episodes.map((e, i) => ({
        id: `${PREFIX}:${showB64}:${b64.enc(e.url)}`,
        title: e.title || `Episode ${e.number}`,
        season: 1, episode: e.number,
        released: new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString(),
      })),
    },
  };
}));

app.get(['/stream/:type/:id.json', '/:config/stream/:type/:id.json'], wrap(async (req, cfg) => {
  const parts = req.params.id.split(':');
  if (parts.length < 3) return { streams: [] };
  const p = await loadProvider(cfg);
  const found = await p.streams(b64.dec(parts[2]));
  return {
    streams: found.map((s, i) => ({
      name: p.name,
      title: `${/\.m3u8/i.test(s.url) ? 'HLS' : 'MP4'} · source ${i + 1}`,
      url: s.url,
      behaviorHints: {
        notWebReady: true,
        proxyHeaders: { request: { Referer: s.referer, Origin: new URL(s.referer).origin } },
      },
    })),
  };
}));

export default app;
if (!process.env.VERCEL) app.listen(PORT, () => console.log(`AniSite addon on http://127.0.0.1:${PORT}/configure`));
