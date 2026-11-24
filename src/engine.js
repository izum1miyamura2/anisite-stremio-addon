// Generic, selector-driven scraper. A "provider" JSON describes a site;
// this file turns it into search / meta / streams for Stremio.
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const cache = new Map();
const TTL = 10 * 60 * 1000;

export async function fetchText(url, referer) {
  const key = url + '|' + (referer || '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const v = await res.text();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// "css"        -> text of the first match
// "css@attr"   -> attribute of the first match
// "@attr"      -> attribute of the element itself
function pick($, el, spec) {
  if (!spec) return undefined;
  const [sel, attr] = spec.split('@');
  const node = sel.trim() ? $(el).find(sel.trim()).first() : $(el);
  if (!node.length) return undefined;
  const v = attr ? node.attr(attr.trim()) : node.text();
  return v ? v.trim() : undefined;
}

const abs = (u, base) => { try { return u ? new URL(u, base).href : undefined; } catch { return undefined; } };
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export const b64 = {
  enc: (s) => Buffer.from(s).toString('base64url'),
  dec: (s) => Buffer.from(s, 'base64url').toString(),
};

export function jsonProvider(p) {
  const base = p.baseUrl.replace(/\/$/, '');

  return {
    name: p.name,

    async search(query) {
      const url = fill(p.search.url, { base, query: encodeURIComponent(query) });
      const $ = cheerio.load(await fetchText(url));
      const out = [];
      $(p.search.item).each((_, el) => {
        const link = abs(pick($, el, p.search.link), url);
        const name = pick($, el, p.search.title);
        if (!link || !name) return;
        out.push({ url: link, name, poster: abs(pick($, el, p.search.poster), url) });
      });
      return out;
    },

    async meta(showUrl) {
      const s = p.show;
      const $ = cheerio.load(await fetchText(showUrl));
      const root = $.root();
      const eps = [];
      $(s.episode).each((i, el) => {
        const link = abs(pick($, el, s.episodeLink || '@href'), showUrl);
        if (!link) return;
        const numText = pick($, el, s.episodeNumber) || '';
        const num = parseFloat((numText.match(/\d+(\.\d+)?/) || [])[0]) || i + 1;
        eps.push({ url: link, number: num, title: pick($, el, s.episodeTitle) });
      });
      if (s.reverseEpisodes) eps.reverse();
      return {
        name: pick($, root, s.title) || 'Unknown',
        poster: abs(pick($, root, s.poster), showUrl),
        description: pick($, root, s.description),
        episodes: eps,
      };
    },

    async streams(episodeUrl) {
      const depth = p.stream?.iframeDepth ?? 2;
      const found = new Map(); // url -> referer
      await collect(episodeUrl, null, depth, found, p.stream?.iframe);
      return [...found].map(([url, referer]) => ({ url, referer }));
    },
  };
}

// Look for direct video URLs in a page, then follow iframes/embeds.
async function collect(pageUrl, referer, depth, found, iframeSel) {
  let html;
  try { html = await fetchText(pageUrl, referer); } catch { return; }
  const $ = cheerio.load(html);

  $('video[src], video source[src], source[src]').each((_, el) => {
    const u = abs($(el).attr('src'), pageUrl);
    if (u && !u.startsWith('blob:')) found.set(u, pageUrl);
  });
  const text = html.replace(/\\\//g, '/');
  for (const m of text.matchAll(/https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/gi)) {
    found.set(m[0], pageUrl);
  }

  if (depth <= 0) return;
  const frames = new Set();
  $(iframeSel ? iframeSel.split('@')[0] : 'iframe').each((_, el) => {
    const attr = iframeSel?.split('@')[1] || 'src';
    const u = abs($(el).attr(attr) || $(el).attr('data-src'), pageUrl);
    if (u && u.startsWith('http')) frames.add(u);
  });
  for (const f of frames) await collect(f, pageUrl, depth - 1, found);
}
