# ContentCraft Frontend

Vite, React, TypeScript, Tailwind CSS, React Router, TanStack Query, Zod, and Radix UI build the ContentCraft web client.

## Setup

From this directory:

```sh
npm install
npm run dev
```

The development server uses `http://127.0.0.1:5173` and proxies `/api/*` to FastAPI at `http://127.0.0.1:8000`. Start the backend from the workspace root using the Python setup documented in the root README.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Browser-visible API base. Set this to the API gateway base when not using the Vite proxy. |
| `VITE_BACKEND_URL` | `http://127.0.0.1:8000` | Vite development proxy target. |

Vite variables are public and must not contain secrets.

## Commands

```sh
npm run dev
npm run build
npm test
npm run test:watch
npm run test:e2e
```

The Playwright smoke test requires Google Chrome to be installed. It starts a mock-provider FastAPI service and Vite server on ports 8001 and 5174, using a temporary SQLite database, then exercises upload through publishing and audit.

## Structure

```text
src/
  api/                 Typed fetch client, Zod schemas, client tests
  components/ui/       Shared accessible UI components
  pages/               Catalog, Generate, Review, Overview, Publish, Audit
  test/                Vitest setup
  utils/               CSV and download helpers
tests/e2e/              Playwright full-flow smoke test
```

## API Mismatches

- The backend has no product-list endpoint. Catalog products live in the TanStack Query cache for the current browser session; after a full reload, re-upload products to restore that session's list.
- `GET /content` supports only `product_description` as a content type. The UI exposes only that supported type.
- `flagged=true/false` filters current `approval_status`; Overview's QC ratio counts each item's latest persisted QC result. These counts can differ after approval, rejection, or publication.
- `GET /audit` returns a list without a total count or cursor; the UI requests up to 200 events.
- `POST /publish` returns a raw CSV body rather than JSON; the client downloads it as text.
- Shopify and WooCommerce destinations are backend stubs that return 501. Publish currently offers CSV only.