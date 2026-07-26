# Federation of Polish Student Societies in the UK — website

Static website for **polsocfederation.pl**. No build step, no frameworks —
plain HTML/CSS/JS, so it can be hosted anywhere (GitHub Pages, Netlify,
Cloudflare Pages, or any web host).

## Pages

| File | Page |
|---|---|
| `index.html` | Landing page |
| `team.html` | 2025/26 committee |
| `events.html` | Events overview |
| `event-business-forum.html` | Polish Business Forum 2026 |
| `event-sikorski-debate.html` | Sikorski Institute debate |
| `event-christmas-dinner.html` | Christmas Dinner 2025 |
| `event-youth-congress.html` | Polish Youth Congress 2025 |
| `event-icebreaker.html` | Icebreaker |
| `announcements.html` | Announcements gallery (click to expand) |
| `members.html` | Member societies + interactive UK map |
| `contact.html` | Contact, socials, address |

## How to update things

### Add photos
Every dashed box on the site is a photo placeholder:

```html
<div class="ph" data-label="Photo"></div>
```

Put your image in `assets/photos/` (create subfolders as you like) and add an
`<img>` inside the box:

```html
<div class="ph"><img src="assets/photos/pbf/main-stage.jpg" alt="Main stage"></div>
```

The dashed border and label disappear automatically once an image is inside.
Same trick works for team headshots and partner logos.

### Replace the logo
`assets/logo.svg` is a recreation of the Federation logo. To use the original
file, save it as `assets/logo.svg` (or drop in a PNG and search-and-replace
`assets/logo.svg` → `assets/logo.png` across the HTML files).

### Add an announcement
Edit `js/announcements-data.js` — copy an existing block to the top of the
list and change the text. Instructions are in the file.

### Add / edit a society pin on the map
Edit `js/societies-data.js` — each entry is one pin (name, university,
coordinates, Instagram, website). The current entries are examples.
Coordinates: right-click the spot on Google Maps → copy the numbers.

### Add a new event
1. Copy an `event-*.html` file and rewrite its content.
2. Add a card for it at the top of the list in `events.html`.

### Fill in the blanks
Search the files for `#` links and `TODO`:
- Social media URLs (footer of every page + `contact.html`)
- LinkedIn URLs on `team.html`
- Correspondence address in `contact.html`
- "Open full photo gallery" link in `event-business-forum.html`
  (point it at Google Photos / Drive / Pixieset etc.)

## Preview locally
Just open `index.html` in a browser, or run a tiny server for the map page:

```
python -m http.server
```

then visit http://localhost:8000.
