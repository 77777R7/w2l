# W2L public preview

The first-use page accepts one public HTTP(S) URL and shows readable content, the final URL, the result state, and elapsed time. Amazon.sg `/dp/{ASIN}` pages also show a fixed product record. It exposes a price only when the selected ASIN, Singapore delivery context, and SGD currency can be verified; otherwise the product record is marked incomplete with explicit issues. Crawl, batches, and Monitor remain separate authenticated/persistent workflows.

The same static build includes an English `/docs/` site generated from
`apps/public-web/content/`. It links the first page trial to the locally
verified Codex MCP path and separates that from the pending hosted login and
permanent MCP URL. The docs use the Hero palette with a quieter reading area.

The Hero keeps the static mountain artwork and uses the [React Bits ASCIIText JS-CSS component](https://reactbits.dev/text-animations/ascii-text). The untouched registry source is vendored at `apps/public-web/src/reactbits/ASCIIText.registry.jsx` (SHA-256 `5188e633807ed6f3d55ee9ed3c48f87e9eb7cc185b31d7d8d5d16f895b3fae72`); the adjacent `ASCIIText.jsx` adapts it for this page by removing remote font loading, pausing offscreen, and moving ASCII glyphs away from a stationary pointer. Four instances use `text="hello_world"`, `enableWaves={true}` and `asciiFontSize={16}`. In `fieldMode` the text seeds a continuous luminance texture instead of drawing the word silhouette, so the React Bits shader produces a filled ASCII field with no permanent letter-shaped holes. Soft masks fade only the field's perimeter into the artwork. The central headline and input remain clear. Touch, narrow screens and reduced-motion mode use the static artwork only; the form and extraction path do not depend on WebGL. React, React DOM and the registry-listed Three.js dependency are confined to a lazy decorative chunk.

## Try it

Open the public HTTPS service URL, paste a page address, and choose **Extract page**. The Firecrawl Introduction example on the page is a public documentation smoke test. A blocked, partial, or timed-out result is displayed as such. The page makes no promise to access login walls or solve challenges. The page and `POST /api/preview` are on the same HTTPS origin; no local repository, MCP connection, or service key is needed by visitors.

The anonymous allowance is three attempts per browser visitor per UTC day and 100 attempts globally per UTC day. A signed, HttpOnly, SameSite=Lax cookie identifies a visitor; direct clients without that cookie use a conservative address-based fallback. The Firestore counters survive service restarts. An unavailable quota store denies preview requests. The web page and `/api/health` remain available when preview is disabled. For Amazon.sg, the public readable body is a short summary built from the checked subject record, so unrelated recommendation prices in the raw page are not shown as this product's content.

Amazon.sg browser requests also use one Firestore-backed origin lease across the two Cloud Run instances. It preserves spacing and observed Retry-After cooldown, and exhausted visitors are rejected by a read-only quota check before acquiring that lease. This coordination is specific to Amazon.sg; generic public HTTP pages still use per-request scheduling, so this release does not claim shared cross-instance pacing for every domain.

## Local integration

Run `npm ci`, then `npm run public:preview:local` to open `http://127.0.0.1:8798/`. Set `W2L_AMAZON_PUBLIC_STATE_FILE` to a validated, anonymous Singapore preference state to try Amazon.sg locally. This review server binds loopback and uses in-memory daily limits and Amazon spacing; **its counters and coordination reset on restart**, so it must not be exposed publicly. The production CLI intentionally requires Firestore configuration. Keep `W2L_CAPTURE_RAW_DIR` unset. The public service never starts the Monitor or Delivery workers and does not persist crawl state or captured HTML.

For a local network where Reddit or X is unreachable directly, the review launcher can reuse an unauthenticated loopback HTTP proxy from `HTTPS_PROXY` (or the explicit `W2L_PUBLIC_PREVIEW_PROXY_URL`). Only fixed Reddit/X HTTPS hosts use it; all other visitor URLs retain the DNS-pinned direct path. Their current robots rules deny generic crawling, so the default still reports a policy block. For an **explicit local-only** public-page experiment, run `W2L_PUBLIC_PREVIEW_PLATFORM_EXCEPTION=true npm run public:preview:local`. This labels the exception in the HTTP trace and never changes the production launcher or other domains. It does not pass login walls or network verification challenges: a Reddit verification page is reported as blocked, never as post content. X post metadata is accepted only if canonical URL, `og:url`, author and text identify the requested status.

## Cloud Run deployment

Use a dedicated Google Cloud project with billing enabled. This deployment uses a request-based Cloud Run service in `asia-southeast1`, a Firestore Native `(default)` database for atomic quota counters, and Secret Manager for the anonymous Amazon preference state and server-only secrets. Cloud Run's free tier does not guarantee a zero bill: networking, builds, image storage, and other usage can be billed. Set a billing alert, but treat the application quota and instance limit as the primary controls. [Cloud Run pricing](https://cloud.google.com/run/pricing) · [Firestore free quota](https://firebase.google.com/docs/firestore/quotas) · [budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)

Before deployment, run the source build and tests and freeze a clean commit. The following is the owner deployment runbook, not a visitor installation procedure. Set the real project ID and authenticate the local Google Cloud CLI; signing in to another provider's dashboard does not authenticate `gcloud`.

```sh
export W2L_PROJECT_ID='YOUR_GOOGLE_CLOUD_PROJECT_ID'
export W2L_REGION='asia-southeast1'
export W2L_REPOSITORY='w2l-public-preview'
gcloud auth login
gcloud billing projects describe "$W2L_PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com --project="$W2L_PROJECT_ID"
```

Confirm that the billing response says the project is linked to an enabled billing account, and create a [budget alert](https://docs.cloud.google.com/billing/docs/how-to/budgets) before submitting a build. An alert is notification, **not a spend cap**. The Cloud Run maximum instance setting can also be exceeded briefly during traffic spikes, so neither setting guarantees a fixed maximum bill. [Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances)

Inspect the Firestore `(default)` database before creating it. Its location may already be fixed by the project and cannot be changed; the application requires the default database, not a newly named one. If it does not exist, create Native mode in Singapore:

```sh
gcloud firestore databases describe --database='(default)' --project="$W2L_PROJECT_ID"
# Only if the command above reports that the database does not exist:
gcloud firestore databases create --database='(default)' --location="$W2L_REGION" --type=firestore-native --project="$W2L_PROJECT_ID"
gcloud artifacts repositories create "$W2L_REPOSITORY" --repository-format=docker --location="$W2L_REGION" --description='W2L anonymous preview' --project="$W2L_PROJECT_ID"
gcloud iam service-accounts create w2l-preview --display-name='W2L public preview runtime' --project="$W2L_PROJECT_ID"
export W2L_RUNTIME_SA="w2l-preview@${W2L_PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$W2L_PROJECT_ID" --member="serviceAccount:${W2L_RUNTIME_SA}" --role='roles/datastore.user'
```

The repository and runtime service account creation commands are one-time operations; inspect existing resources before rerunning them. Grant the build identity Artifact Registry Writer **on this repository**:

```sh
export W2L_BUILD_SA_RESOURCE="$(gcloud builds get-default-service-account --region="$W2L_REGION" --project="$W2L_PROJECT_ID" --format='value(serviceAccountEmail)')"
export W2L_BUILD_SA="${W2L_BUILD_SA_RESOURCE##*/}"
test -n "$W2L_BUILD_SA" || { echo 'Cloud Build default service account was not returned' >&2; exit 1; }
gcloud artifacts repositories add-iam-policy-binding "$W2L_REPOSITORY" --location="$W2L_REGION" --member="serviceAccount:${W2L_BUILD_SA}" --role='roles/artifactregistry.writer' --project="$W2L_PROJECT_ID"
```

Google Cloud projects may use either a Cloud Build or Compute Engine default service account, so do not assume its address. [Cloud Build default identity](https://docs.cloud.google.com/build/docs/cloud-build-service-account-updates) · [Firestore server IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam)

Prepare a **fresh unsigned-in** Amazon.sg preference state with `scripts/section-c/ensure-amazon-sg-state.mjs --fresh-only` in `.w2l/`, verify its SHA-256, and upload that exact file as a Secret Manager version. The public release must never reuse an existing browser state: Amazon also puts session-named cookies in fresh anonymous sessions, so cookie names alone cannot prove that a saved state belongs to a signed-out user. The runtime checks scope and currency; the fresh isolated browser run supplies the unsigned-in provenance. The file must not be committed or included in the build context. Create independent random 32-byte-or-longer values for `W2L_QUOTA_HASH_KEY` and `W2L_EVAL_TOKEN` as separate secrets. The evaluation token is for owner-only acceptance testing; it is never served to browsers and bypasses public trial counters. Keep it private and rotate it if exposed.

```sh
umask 077
mkdir -p .w2l/public-preview
npm ci
npm run build:public
export W2L_AMAZON_PUBLIC_STATE_FILE="$PWD/.w2l/public-preview/amazon-state-$(date -u +%Y%m%dT%H%M%SZ).json"
node scripts/section-c/ensure-amazon-sg-state.mjs --fresh-only
shasum -a 256 "$W2L_AMAZON_PUBLIC_STATE_FILE"
openssl rand -hex 32 > .w2l/public-preview/quota-hash-key
openssl rand -hex 32 > .w2l/public-preview/eval-token
gcloud secrets create w2l-amazon-state --replication-policy=automatic --data-file="$W2L_AMAZON_PUBLIC_STATE_FILE" --project="$W2L_PROJECT_ID"
gcloud secrets create w2l-quota-hash-key --replication-policy=automatic --data-file=.w2l/public-preview/quota-hash-key --project="$W2L_PROJECT_ID"
gcloud secrets create w2l-eval-token --replication-policy=automatic --data-file=.w2l/public-preview/eval-token --project="$W2L_PROJECT_ID"
for secret in w2l-amazon-state w2l-quota-hash-key w2l-eval-token; do
  gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:${W2L_RUNTIME_SA}" --role='roles/secretmanager.secretAccessor' --project="$W2L_PROJECT_ID"
done
```

If a secret already exists, add a new version with `gcloud secrets versions add SECRET --data-file=FILE` rather than recreating it. Avoid printing secret contents or passing them as command arguments. [Cloud Run secret mounts and environment references](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

Build the Docker image in Cloud Build using `cloudbuild.public-preview.yaml`, then deploy it. Use the exact clean source SHA as the image tag; `.gcloudignore` keeps local state, tests, and unrelated project files out of the upload. The image contains Chromium but no Amazon preference state.

```sh
test -z "$(git status --porcelain)" || { echo 'Commit and verify a clean source tree before deployment' >&2; exit 1; }
export W2L_SOURCE_SHA="$(git rev-parse HEAD)"
export W2L_IMAGE="${W2L_REGION}-docker.pkg.dev/${W2L_PROJECT_ID}/${W2L_REPOSITORY}/public-preview:${W2L_SOURCE_SHA}"
gcloud builds submit . --config=cloudbuild.public-preview.yaml --region="$W2L_REGION" --timeout=20m --substitutions="_IMAGE=${W2L_IMAGE}" --project="$W2L_PROJECT_ID"
gcloud run deploy w2l-public-preview --image="$W2L_IMAGE" --region="$W2L_REGION" --project="$W2L_PROJECT_ID" \
  --service-account="$W2L_RUNTIME_SA" --allow-unauthenticated \
  --cpu=1 --memory=2Gi --concurrency=1 --min-instances=0 --max-instances=2 --timeout=60s \
  --set-env-vars="W2L_FIRESTORE_PROJECT_ID=${W2L_PROJECT_ID},W2L_AMAZON_PUBLIC_STATE_FILE=/var/secrets/amazon-state.json,W2L_PREVIEW_ENABLED=true,W2L_SOURCE_COMMIT=${W2L_SOURCE_SHA}" \
  --update-secrets='/var/secrets/amazon-state.json=w2l-amazon-state:latest,W2L_QUOTA_HASH_KEY=w2l-quota-hash-key:latest,W2L_EVAL_TOKEN=w2l-eval-token:latest'
gcloud run services describe w2l-public-preview --region="$W2L_REGION" --project="$W2L_PROJECT_ID" --format='value(status.url)'
```

The `--allow-unauthenticated` flag is intentional for this limited, public trial. The Secret Manager grants are restricted to the dedicated runtime service account. Secret versions referenced as environment variables are resolved at instance startup; after rotating those secrets, deploy a new revision so every instance uses the new value. Verify the actual `/api/health` and preview behavior on the returned HTTPS URL before sharing it.

The initial Cloud Run settings are:

| Setting | Initial value |
| --- | --- |
| Region | `asia-southeast1` |
| CPU / memory | 1 vCPU / 2 GiB |
| Concurrency / instances | 1 per instance / min 0, max 2 |
| Request timeout | 60 seconds (preview deadline 40 seconds) |
| Access | Public HTTPS `*.run.app` |
| Environment | `W2L_FIRESTORE_PROJECT_ID`, `W2L_AMAZON_PUBLIC_STATE_FILE=/var/secrets/amazon-state.json`, `W2L_PREVIEW_ENABLED=true`, `W2L_SOURCE_COMMIT` |
| Secrets | Mount Amazon state at `/var/secrets/amazon-state.json`; expose quota hash key and evaluation token as server environment variables |

The image is built from `Dockerfile.public-preview` and includes Chromium. Do not deploy the existing `render.yaml` managed MCP service as this anonymous page: that service has durable Monitor/Delivery semantics and a different authentication policy. Cloud Run's local files are ephemeral, so they cannot back persistent tasks. [Cloud Run browser support](https://docs.cloud.google.com/run/docs/browser-automation) · [container filesystem](https://docs.cloud.google.com/run/docs/container-contract)

To pause anonymous capture without removing the public page, run `gcloud run services update w2l-public-preview --region="$W2L_REGION" --project="$W2L_PROJECT_ID" --update-env-vars=W2L_PREVIEW_ENABLED=false`. The deployment must not set `W2L_CAPTURE_RAW_DIR` or the local Reddit/X proxy/exception options. Never enable arbitrary-domain browser fallback: the public browser path is restricted to Amazon.sg and its fixed resource hosts; generic pages use the guarded HTTP path.

## Release checks

Check `/api/health`, then complete a real public-document extraction in the browser and inspect its final URL, state, body, and visible elapsed time. Test an Amazon.sg `/dp/{ASIN}` from the same page and confirm the requested/selected ASIN, Singapore location, SGD currency, and explicit issues on uncertainty. Exercise wrong-origin, private/metadata URL, redirect, invalid URL, quota exhaustion, and Firestore-unavailable cases. Record warm/cold p50/p95 including failures and retry time, and inspect Cloud Run billing rather than inferring cost from the free tier.

The fixed 100-product manifest is `research/amazon-product-holdout-100-sg.v1.json`. Run `scripts/public-preview/verify-holdout.mjs` from the **same clean source commit** as the deployed service. It sends all 100 fixed URLs through the HTTPS `/api/preview` endpoint, compares the reported source and anonymous-state hashes, and saves the owner-only same-capture HTML witnesses under ignored `.w2l/` for review. This cohort was already seen in local experiments; this is a public-path regression, **not another 100 unseen products**.

```sh
export W2L_PREVIEW_BASE_URL="$(gcloud run services describe w2l-public-preview --region="$W2L_REGION" --project="$W2L_PROJECT_ID" --format='value(status.url)')"
IFS= read -r W2L_EVAL_TOKEN < .w2l/public-preview/eval-token
export W2L_EVAL_TOKEN
export W2L_EXPECT_AMAZON_STATE_SHA256="$(shasum -a 256 "$W2L_AMAZON_PUBLIC_STATE_FILE" | awk '{print $1}')"
node scripts/public-preview/verify-holdout.mjs
unset W2L_EVAL_TOKEN
```

Keep the generated report and every failed or blocked row in the denominator. Compare field values against the saved same-capture HTML before reporting **output accuracy** and **visible-field coverage** separately; have Howard sign off the independent field review. The runner's automatic 100/100 checks do not establish those two human-reviewed rates. Finally, have one non-author open the link and complete a documentation scrape unaided; record the outcome separately from automated tests.

### New 100-product candidate

The committed 100-URL set above is a **regression set**. To satisfy a new-product holdout, freeze a separate cohort before evaluating any of its detail pages. `discover-unseen-100.mjs` uses W2L MCP to fetch only Amazon.sg bestseller **listing** pages and collects product links from them. It excludes ASINs recorded in tracked manifests, fixtures and evidence, plus ignored reports from all registered local Git worktrees; use `--archive-evidence DIR` for an older evidence directory no longer attached as a worktree. The ignored discovery ledger records each scanned file's SHA-256, the ASIN exclusion-set hash, listing statuses and the clean source commit. “Unseen” means absent from those recorded sources; it cannot prove an absolute history of browsing elsewhere.

```sh
test -z "$(git status --porcelain)" || { echo 'Commit a clean source first' >&2; exit 1; }
export W2L_UNSEEN_DIR="$PWD/.w2l/public-preview/unseen-100-sg/$(date -u +%Y%m%dT%H%M%SZ)"
node scripts/public-preview/discover-unseen-100.mjs \
  --state-file "$W2L_AMAZON_PUBLIC_STATE_FILE" --output-dir "$W2L_UNSEEN_DIR"
# If discovery freezes fewer than 100, keep the failure report and add new
# listing categories in a new source commit; do not substitute products after evaluation.
IFS= read -r W2L_EVAL_TOKEN < .w2l/public-preview/eval-token
export W2L_EVAL_TOKEN
node scripts/public-preview/verify-holdout.mjs \
  --manifest "$W2L_UNSEEN_DIR/manifest.json" --output-dir "$W2L_UNSEEN_DIR/evaluation"
unset W2L_EVAL_TOKEN
# Only after all 100 evaluation rows have hash-matched same-capture HTML:
node scripts/section-b/amazon-holdout-review.mjs \
  --report "$W2L_UNSEEN_DIR/evaluation/report.json" \
  --output-dir "$W2L_UNSEEN_DIR/evaluation/review"
```

Discovery and public-path evaluation must use the same clean source commit and exact anonymous Singapore state hash. The public-path runner refuses a changed discovery ledger, different deployed source, or changed state; it keeps every failed product in the fixed denominator. A run with missing HTML remains failed; do not omit those rows or replace URLs to make the review script pass. The evaluator itself is run against the deployed HTTPS page API with the owner token. `amazon-holdout-review.mjs` reports machine-assisted output accuracy and visible-field coverage against same-capture HTML; its selectors and candidate leak checks require independent review and Howard's sign-off before either rate is accepted.
