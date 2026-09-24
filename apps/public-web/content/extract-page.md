# Extract a public page

Use the W2L page when you want readable content from one public HTTP(S) URL without setting up a task. The browser submits only the URL; capture settings and service secrets remain on the server.

## Input

Open [Try W2L](/), paste `https://docs.firecrawl.dev/introduction`, and press **Extract page**. This public documentation URL is the first-use example. When this site is served over public HTTPS, the page and extraction API use the same address; no local installation is needed for this single-page preview.

## Expected output

The result card shows the final URL, status, a title when found, readable Markdown, and total client-visible time. Choose **Result JSON** to inspect the full result envelope, including the requested URL. Copy or download Markdown (`.md`) or JSON (`.json`) from the same capture; switching output format does not spend another preview.

For the exact recorded success sample and its observation time, see [Introduction](/docs/). The result may differ when the source page changes.

## If extraction does not complete

- **Blocked:** the site denied automated access, required login, or returned a verification page. Try another permitted public page; W2L does not solve a challenge.
- **Timed out:** the source or local outbound path did not finish within the preview deadline. Check the final URL and reason. A timeout alone does not prove that the site's parser is wrong.
- **Incomplete:** content or identity could not be fully verified. Read what is available and its missing reason; do not treat it as a complete record.
- **Daily limit reached:** stop until the applicable quota resets. The local review server's counters reset on restart; the hosted preview uses durable counters.

See [limits and result states](/docs/limits/) before relying on an extracted field in another system.
