# Kebabhouse Karlskrona

A responsive restaurant starter built with React, strict TypeScript, Vite,
and Tailwind. The food illustration is bundled in `public/assets/pizza.svg`.

Before publishing, confirm the menu, prices, allergens, opening hours and contact
details with the restaurant, and connect the actual online ordering URL. These
details are deliberately not invented; the ordering section states it is not yet
connected.

Use Node.js 20.19+ or 22.12+. Run `npm install`, then `npm run dev`.
Run `npm run typecheck` and `npm run build` before deployment.
Deploy `dist/` to a static host with an SPA fallback to `index.html` so direct
route URLs work.

`src/app/` owns startup, routing and providers. Pages compose shared layout,
sections and typed UI primitives. Add hooks for reusable state, services for
business/data-access operations, integrations for provider clients, and domain
types only when the application needs them. Do not add mock authentication or
unused services. Local images belong in `public/assets/` or `src/assets/`.

Design tokens live in `src/styles/globals.css`; the serializable Tailwind theme
extension in `src/styles/theme.json` is shared by the build and Atelier preview.
The preview does not execute project configuration or package scripts, install
packages, or provide server credentials. Public `VITE_` variables are bundled
into browser code: never use them for secrets. No environment variables or
external API credentials are required by this website.
