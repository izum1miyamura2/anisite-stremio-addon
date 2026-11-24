# AniSite – a Stremio addon for any site you choose

Search a site from inside Stremio, browse its episodes, and play the video links it finds.
The site is just a config file, so you can switch it whenever you like.

## Run it
```bash
npm install
npm start            # http://127.0.0.1:7000/configure
npm test             # end-to-end test against a built-in mock site
```
Open `/configure`, pick a preset (or paste provider JSON), and click **Install in Stremio**.
Then search in Stremio's search bar: results show up under "AniSite: <site>".

To use it on your phone or TV, Stremio has to reach the server. Host it (Render, Railway, a VPS)
or run it on your PC and use your LAN IP. Stremio needs **HTTPS** for anything that isn't localhost,
so on a LAN use a tunnel (`cloudflared tunnel --url http://localhost:7000`) or a host that gives HTTPS.

## Deploy (needed for TV / phone)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/izum1miyamura2/anisite-stremio-addon)

Free on Vercel, which gives you an HTTPS address like `https://anisite-stremio-addon.vercel.app`.
Open `/configure` on that address, generate the link, and install it on your phone. Stremio syncs
addons to your account, so it shows up on your TV automatically when you're signed in to the same account.

## Switching sites
- **Presets:** drop `providers/<name>.json` (or `.js`) in the folder. It appears in the configure dropdown.
- **Ad-hoc:** paste the JSON straight into the configure page. No restart needed.
- Each config installs as its own addon, so you can have several sites installed side by side.

## Writing a provider JSON (`providers/_template.json`)
Open the site in a desktop browser, right-click → Inspect, and fill in CSS selectors:

| Field | Meaning |
|---|---|
| `search.url` | Search URL; `{base}` and `{query}` get filled in |
| `search.item` | One element per search result |
| `title` / `link` / `poster` | Selectors *inside* that item. `sel` = text, `sel@attr` = attribute, `@attr` = the item's own attribute |
| `show.episode` | One element per episode on the show page |
| `reverseEpisodes` | Set `true` if the site lists newest first |
| `stream.iframe` | Which iframes to follow to find the player (default: all) |

For streams, the addon looks for `<video>`/`<source>` tags and any `.m3u8`/`.mp4` URL in the episode page,
then follows the player iframes (2 levels deep by default) and passes the right `Referer` to Stremio.

## When JSON isn't enough
Many sites load episode lists or players through JavaScript/AJAX, so the HTML has nothing to select.
In that case, open DevTools → Network, find the request that returns the episodes or the video link,
and write a JS provider from `providers/_custom-template.js` that calls those endpoints directly.
Players that encrypt their sources won't work with the generic approach.
