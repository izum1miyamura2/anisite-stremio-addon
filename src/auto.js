// Auto mode: give it only a website URL and it guesses everything else.
// Heuristics: OpenSearch descriptor / search <form> / common URL patterns for search,
// "repeated cards with a link + image" for results, "links that look like episodes"
// for the episode list, and the generic stream finder for video URLs.
import * as cheerio from 'cheerio';
import { fetchText, findStreams, abs } from './engine.js';

const COMMON_SEARCH = [
  '/search?keyword={query}', '/search?q={query}', '/search?query={query}',
  '/?s={query}', '/search/{query}', '/browse?search={query}', '/filter?keyword={query}',
];
const SEARCH_NAMES = /^(q|s|query|keyword|keywords|search|term|k|name|title)$/i;
const EP_HREF = /(?:ep|episode|eps)[-_/=]?(\d+(?:\.\d+)?)(?!.*(?:ep|episode)[-_/=]?\d)/i;
const EP_TEXT = /^\s*(?:ep(?:isode)?\.?\s*)?(\d+(?:\.\d+)?)\b/i;
const searchCache = new Map();

const sameSite = (u, base) => {
  try { return new URL(u).hostname.replace(/^www\./, '') === new URL(base).hostname.replace(/^www\./, ''); }
  catch { return false; }
};
const signature = ($, el) => {
  const part = (n) => n.length ? `${n[0].tagName}.${(n.attr('class') || '').trim().split(/\s+/).sort().join('.')}` : '';
  const $el = $(el);
  return [part($el), part($el.parent()), part($el.parent().parent())].join('>');
};
const imgSrc = ($img) => $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-original') || $img.attr('src');

// ---------- search detection ----------
async function detectSearch(base) {
  if (searchCache.has(base)) return searchCache.get(base);
  const candidates = [];
  try {
    const $ = cheerio.load(await fetchText(base));

    // 1) OpenSearch descriptor (a web standard many sites ship)
    const os = $('link[rel="search"][type*="opensearch"]').attr('href');
    if (os) {
      try {
        const xml = await fetchText(abs(os, base));
        const m = xml.match(/<Url[^>]*type="text\/html"[^>]*template="([^"]+)"/i)
          || xml.match(/<Url[^>]*template="([^"]+)"[^>]*type="text\/html"/i);
        if (m) candidates.push(m[1].replace(/&amp;/g, '&').replace('{searchTerms}', '{query}').replace(/\{[^}]+\?\}/g, ''));
      } catch {}
    }

    // 2) A GET search form on the homepage
    $('form').each((_, f) => {
      const method = ($(f).attr('method') || 'get').toLowerCase();
      if (method !== 'get') return;
      const input = $(f).find('input[type="search"], input[type="text"], input:not([type])')
        .filter((_, i) => $(i).attr('type') === 'search' || SEARCH_NAMES.test($(i).attr('name') || '')).first();
      const name = input.attr('name');
      if (!name) return;
      const action = abs($(f).attr('action') || base, base);
      const extra = $(f).find('input[type="hidden"][name]').map((_, h) =>
        `&${encodeURIComponent($(h).attr('name'))}=${encodeURIComponent($(h).attr('value') || '')}`).get().join('');
      candidates.push(`${action}${action.includes('?') ? '&' : '?'}${encodeURIComponent(name)}={query}${extra}`);
    });
  } catch {}

  // 3) Common URL patterns
  candidates.push(...COMMON_SEARCH.map((c) => base + c));

  // Keep the first candidate that actually returns results for a common word
  for (const tpl of [...new Set(candidates)]) {
    try {
      const url = tpl.replace('{query}', 'one');
      const results = extractResults(cheerio.load(await fetchText(url)), url, 'one');
      if (results.length) { searchCache.set(base, tpl); return tpl; }
    } catch {}
  }
  throw new Error(`Couldn't detect how to search ${base}`);
}

// ---------- search results ----------
function extractResults($, pageUrl, query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const groups = new Map();

  $('a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), pageUrl);
    if (!href || !sameSite(href, pageUrl) || href.split('#')[0] === pageUrl.split('#')[0]) return;
    // the "card" is the link itself, or the nearest ancestor that also holds an image
    let card = $(a);
    for (let i = 0; i < 3 && !card.find('img').length && !card.is('img'); i++) card = card.parent();
    const img = card.find('img').first();
    if (!img.length) return;
    const title = $(a).attr('title') || card.find('h1,h2,h3,h4,.title,.name,[class*="title"],[class*="name"]').first().text().trim()
      || img.attr('alt') || $(a).text().trim();
    if (!title || title.length < 2) return;
    const sig = signature($, card[0]);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push({ url: href, name: title.replace(/\s+/g, ' ').trim(), poster: abs(imgSrc(img), pageUrl) });
  });

  let best = [], bestScore = 0;
  for (const items of groups.values()) {
    const uniq = [...new Map(items.map((i) => [i.url, i])).values()];
    const hits = uniq.filter((i) => words.some((w) => i.name.toLowerCase().includes(w))).length;
    const score = uniq.length + hits * 3;
    if (score > bestScore) { best = uniq; bestScore = score; }
  }
  return best;
}

// ---------- show page ----------
function extractShow($, showUrl) {
  const meta = (p) => $(`meta[property="${p}"], meta[name="${p}"]`).attr('content');
  const groups = new Map();

  $('a[href]').each((_, a) => {
    const href = abs($(a).attr('href'), showUrl);
    if (!href || !sameSite(href, showUrl)) return;
    const text = $(a).text().trim();
    const label = $(a).attr('title') || $(a).attr('data-title') || '';
    const m = href.match(EP_HREF) || text.match(EP_TEXT) || ($(a).attr('data-number') || '').match(/(\d+(?:\.\d+)?)/);
    if (!m) return;
    const sig = signature($, a);
    if (!groups.has(sig)) groups.set(sig, []);
    const sub = $(a).find('[class*="title"], [class*="name"]').first().text().trim();
    groups.get(sig).push({ url: href, number: parseFloat(m[1]), title: label || sub || (text.length > 4 && !/^\s*(ep|episode)\b/i.test(text) ? text : undefined) });
  });

  // the episode list is the biggest group of similar episode-looking links
  let eps = [];
  for (const g of groups.values()) if (g.length > eps.length) eps = g;
  eps = [...new Map(eps.map((e) => [e.number, e])).values()].sort((a, b) => a.number - b.number);
  if (!eps.length) eps = [{ url: showUrl, number: 1, title: 'Play' }]; // movie / single video page

  return {
    name: (meta('og:title') || $('h1').first().text() || $('title').text())
      .replace(/\s+/g, ' ').replace(/\s+[|–—-]\s+[^|–—-]+$/, '').replace(/^Watch\s+/i, '').trim(),
    poster: abs(meta('og:image') || imgSrc($('img[class*="poster"], .poster img, .cover img').first()), showUrl),
    description: meta('og:description') || meta('description'),
    episodes: eps,
  };
}

export function autoProvider(site) {
  const base = new URL(/^https?:\/\//.test(site) ? site : 'https://' + site).origin;
  return {
    name: new URL(base).hostname.replace(/^www\./, ''),
    async search(query) {
      const tpl = await detectSearch(base);
      const url = tpl.replace('{query}', encodeURIComponent(query));
      return extractResults(cheerio.load(await fetchText(url)), url, query);
    },
    async meta(showUrl) {
      return extractShow(cheerio.load(await fetchText(showUrl)), showUrl);
    },
    streams: (episodeUrl) => findStreams(episodeUrl, 2),
  };
}
