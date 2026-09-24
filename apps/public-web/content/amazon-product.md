# Check an Amazon.sg product as JSON

W2L's Amazon.sg product path checks the main product on `/dp/{ASIN}` pages before returning structured fields. The adapter is **Beta**. It does not make an Amazon price alert or guarantee that every visible offer has a confirmed price.

## Input

On the [W2L page](/), paste a public `https://www.amazon.sg/dp/{ASIN}` URL. A server-configured anonymous Singapore preference is required for product previews. In Codex with the [local MCP service](/docs/connect-mcp/), ask:

```text
Use W2L scrape_product on https://www.amazon.sg/dp/B000VW9PIK. Show the requested and selected ASIN, title, price, currency, seller, delivery location, field evidence, and missing reasons. Do not treat a page capture as a complete product record unless the checks pass.
```

That ASIN is an example request, not a promise of a live offer. The server's product schema and anonymous region preference are fixed for this path; no external model is called by `scrape_product`.

## Expected output

Check these separately: page capture `status`, product `json.status`, selected main ASIN versus requested ASIN, delivery to **Singapore 238823**, and **SGD** currency for a visible offer. A complete product result can include title, brand, price, seller, availability, delivery context, and field evidence. A page capture marked `success` can still have incomplete product JSON.

If the main ASIN, region, or currency is unverified, the public preview reports an incomplete product and hides unverified price and offer details. Missing or inapplicable fields stay null with issues; recommendation products must not become the main product. Downloaded **Result JSON** is the preview result envelope, not a promise that every product field is present.

## If a field is missing or the page changes

Read `product.issues` or the MCP tool's field evidence. A page selecting a different ASIN is a subject mismatch, even if the requested URL looks correct. A delivery-region mismatch makes an offer incomparable. Do not fill missing prices from recommended products or another currency. If blocked or timed out, retain that outcome and retry only after checking the reason and site limits.

The checked 100-product holdout had one honest subject mismatch; the strict 100/100 subject gate and the 1000-page reliability gate remain open. See [limits](/docs/limits/) for the current support boundary.
