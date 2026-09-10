# Grimm

Upload the lecture slides and handouts you are studying, and get back a set of
clean study notes — bullet-point summaries drawn from every slide or page, in
the order they came or shuffled into a randomised run. Save the result as an
offline HTML file or as a 1-, 2-, or 3-column PDF.

Files are read in your browser. Only the text found in them is sent out, and only
to write the notes; the notes themselves are shown on your own device.

## How it works

`assets/js/extract.js` reads PDF, PowerPoint, Word and plain-text files in the
browser and turns them into units, one per slide or page. `generate.js` splits
those units into contiguous batches and calls `api/generate.js`, a Vercel function
that holds your Groq key and never exposes it. Each batch comes back as bullet-point
notes for every slide in that batch.

`assets/js/notes.js` renders the notes on screen in whichever order you chose.
`assets/js/exporter.js` inlines the stylesheet plus the notes engine into one
self-contained HTML document — so the offline copy is the same engine, not a
second implementation.

## Deploy it

```bash
git init
git add .
git commit -m "Grimm"
git branch -M main
git remote add origin https://github.com/<you>/grimm.git
git push -u origin main
```

Then at [vercel.com/new](https://vercel.com/new), import the repo. There is no build
step and no framework to pick; leave the defaults. Before the first deploy finishes,
add your environment variables under Project → Settings → Environment Variables, then
redeploy so the function picks them up.

| Name | Required | What it is |
| --- | --- | --- |
| `GROQ_API_KEY` | yes | A key from [console.groq.com/keys](https://console.groq.com/keys). |
| `ACCESS_CODE` | no | A shared password. Requests without it get 401. |
| `GROQ_MODEL` | no | Model to try first, e.g. `openai/gpt-oss-120b`. |
| `RATE_LIMIT` | no | Requests allowed per IP per 5 minutes. Defaults to 40. |

## Run it locally

```bash
npm i -g vercel
cp .env.example .env.local   # then put your real key in it
vercel dev                   # http://localhost:3000
```

## What it reads

`.pdf`, `.pptx`, `.pptm`, `.docx`, `.docm`, `.txt`, `.md`, `.markdown`, `.csv`.
Add as many at once as you like, from as many subjects as you like.

## Order modes

- **Chronological** — notes in the same order as your slides and pages.
- **Randomised** — notes shuffled with Fisher-Yates; the shuffle is stored in the
  saved file so re-opening it gives the same order.

## The file you keep

"Save as a file" writes one HTML document that carries its own stylesheet and the
notes inside it. Open it from your downloads folder on a plane, on a phone, next
year: the same notes, in the same order.

"Download PDF" opens your browser's print dialog with 1-, 2-, or 3-column layout
applied. Print to PDF from there.

## Layout

```
index.html            the whole interface
api/generate.js       Vercel function; holds the key, calls Groq
lib/notes.js          prompt, JSON repair, note validation (server side)
assets/js/extract.js  files to units, in the browser
assets/js/generate.js batching, API calls
assets/js/notes.js    notes on screen, in both order modes
assets/js/exporter.js the offline file
assets/js/app.js      wiring
assets/js/zip.js      minimal zip reader for pptx/docx
```

Built for study. Use it, fork it, change it.
