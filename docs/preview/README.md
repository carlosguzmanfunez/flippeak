# Design reference

`live-market.html` is a static rendering of the Live Market shell, used to review
the design direction without installing dependencies. It links the same
`src/ui/tokens.css` the application uses, so colour and type-scale values cannot
drift from the product.

It is **not application code**, is not imported by anything, and is not part of
the build. The React components in `src/ui/market/` are authoritative. The layout
CSS in this file mirrors their Tailwind utilities by hand and must be updated if
the components change materially.

The screenshots were captured at 1280px and 390px with a system font fallback,
because the environment they were produced in had no network access to fetch
Instrument Sans. Typography in the running application will differ.
