// Use a JS provider when a site loads episodes or players with JavaScript/AJAX
// and a plain selector config isn't enough. Copy to providers/<name>.js
// (no leading underscore) and it shows up as a preset.
import * as cheerio from 'cheerio';
import { fetchText } from '../src/engine.js';

const BASE = 'https://example-site.tld';

export default {
  name: 'My JS Site',

  // -> [{ url, name, poster }]
  async search(query) {
    const $ = cheerio.load(await fetchText(`${BASE}/search?q=${encodeURIComponent(query)}`));
    return $('.item').map((_, el) => ({
      url: new URL($(el).find('a').attr('href'), BASE).href,
      name: $(el).find('.name').text().trim(),
      poster: $(el).find('img').attr('src'),
    })).get();
  },

  // -> { name, poster, description, episodes: [{ url, number, title }] }
  async meta(showUrl) {
    const $ = cheerio.load(await fetchText(showUrl));
    // Example: episodes come from a JSON endpoint instead of the HTML
    // const id = $('[data-id]').attr('data-id');
    // const data = JSON.parse(await fetchText(`${BASE}/ajax/episodes/${id}`, showUrl));
    return {
      name: $('h1').text().trim(),
      poster: $('.poster img').attr('src'),
      description: $('.synopsis').text().trim(),
      episodes: $('.ep a').map((i, el) => ({
        url: new URL($(el).attr('href'), BASE).href, number: i + 1,
      })).get(),
    };
  },

  // -> [{ url, referer }]  (direct .m3u8 / .mp4 links)
  async streams(episodeUrl) {
    const html = await fetchText(episodeUrl);
    const m = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
    return m ? [{ url: m[0], referer: episodeUrl }] : [];
  },
};
