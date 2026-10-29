# Qloo fixtures (SYNTHETIC)

Everything here is invented for demos and tests. It follows the documented Qloo response shapes
(`/v2/insights`, `/search`, `/v2/tags`, `/v2/analysis/compare`, `/v2/trending`) but no value was
returned by Qloo. Place names, addresses and every affinity, popularity, rating and trend number are
made up; artist and brand names are real public names used only as labels. The UI badges anything
served from here as "Sample data". Real Qloo responses go to `.recordings/` (gitignored) and never
into this folder.

The eight stores of the sample chain each have a distinct neighbourhood signature (`stores-a.ts`,
`stores-b.ts`). `src/server/qloo/fixtures/` expands these into API envelopes at request time and
re-projects them onto any other coordinate, so a store a visitor adds still gets plausible data.
