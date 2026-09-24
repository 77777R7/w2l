# W2L public preview page

Build the static frontend with `npm ci --prefix apps/public-web` and `npm run build --prefix apps/public-web`. The output is `apps/public-web/dist`; the public service must serve this output and `POST /api/preview` from the same origin.

The page sends only `{ "url": string }`. It treats the returned Markdown as untrusted text and renders a small safe subset without injecting page HTML. The visible total elapsed includes the browser request and rendering, while `totalMs` in the API payload is server-side time.

The build also renders eight English Markdown pages from `content/` into
`dist/docs/`. Open `/docs/` on the local preview service for the introduction,
MCP setup, task guides, and limits. The static pages have unique titles and
descriptions, shared navigation, and copyable code examples. Unknown `/docs/`
paths return 404 rather than falling back to the product home page.

The mountain Hero and octopus source are optimized WebP copies of Howard's supplied images in `Downloads`. `octopus-mark.svg` is an unapproved 32–48 px draft. The current navigation uses the supplied octopus image itself; do not treat the draft as approved branding until Howard reviews it.
