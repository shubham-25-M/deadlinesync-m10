# DeadlineSync

A mobile-first assignment deadline dashboard for Indian college students, built with Next.js App Router, Tailwind CSS, and Gemini extraction.

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` from Google AI Studio.
3. Run `npm install`, then `npm run dev`.
4. Open http://localhost:3000.

The committed `.env.local` is intentionally excluded from Git and contains only a setup placeholder. Replace it locally with your own key. Deadlines are stored in browser localStorage; the Gemini key is used only by the server-side `/api/extract` route.

## Deploy

Import the repository into Netlify or Vercel and add `GEMINI_API_KEY` as a server environment variable. The included `netlify.toml` configures the Next.js runtime through the Netlify Next.js adapter. For Vercel, import the repository and add the same environment variable in project settings.
