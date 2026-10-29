# Backend smoke transcript (fixture mode, no keys)

Run: Thu 29 Oct 2026, about 21:15 MYT (13:15 UTC), by the integration worker.
Server: `next dev` on port 3217 with `QLOO_MODE=fixture TF_MODE=fixture TAVILY_MODE=fixture STORE_DRIVER=file`,
plus the real NeMo Guardrails sidecar (`guardrails/start.sh`, port 8000, no model key, so its brand-voice
self-check reports "skipped"). `LE_JOB_SECRET` was a throwaway test value, not a real secret. No Qloo,
Tavily, Token Factory or Nebius call was made; every response is synthetic fixture data.
Each section is a real curl against the live dev server; bodies are cut at 700 characters.
Cookie ids are redacted. Both servers were stopped afterwards.

How to repeat: start the sidecar and `next dev` as above, then curl the routes listed in `docs/CONTRACT.md`.

## Part 1. Setup routes, profile, compare, menu read

### GET /api/status
`GET /api/status` -> HTTP 200
```
{"qloo":"fixture","tokenfactory":"fixture","tavily":"fixture","guardrails":"up","spend":{"usd":0,"capUsd":5}}
```

### GET /api/workspace (first visit sets le_ws cookie)
`GET /api/workspace` -> HTTP 200
```
{"workspace":{"id":"ws_1j6m0e70270b4t3t","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","createdAt":"2026-10-29T13:15:54.692Z"},"chain":{"id":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Kettle & Kiln (sample chain)","category":"coffee","brandVoice":["Warm and plain-spoken, like the person who knows your order.","Neighbourly first: we talk about the block, not about ourselves.","Short sentences, no hype, no exclamation marks."],"anchors":[{"entityId":"sample-blue-bottle-coffee","name":"Blue Bottle Coffee","type":"urn:entity:brand"},{"entityId":"sample-aesop","name":"Aesop","type":"urn:entity:brand"},{"entityId":"sample-muji","name":"Muji","type":"urn:entity:brand"}],"city":{"name":"New York" ...[truncated]

```
set-cookie: le_ws=<redacted-id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000

workspace summary: chain=Kettle & Kiln (sample chain) stores=8 menu=22 latestEditions=8 s1=store_williamsburg~1j6m0e70270b4t3t s2=store_park-slope~1j6m0e70270b4t3t

### PUT /api/chain (rename + brandVoice)
`PUT /api/chain` -> HTTP 200
```
{"id":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Kettle & Kiln East","category":"coffee","brandVoice":["Warm and plain-spoken, like the person who knows your order.","Neighbourly first: we talk about the block, not about ourselves.","Short sentences, no hype, no exclamation marks."],"anchors":[{"entityId":"sample-blue-bottle-coffee","name":"Blue Bottle Coffee","type":"urn:entity:brand"},{"entityId":"sample-aesop","name":"Aesop","type":"urn:entity:brand"},{"entityId":"sample-muji","name":"Muji","type":"urn:entity:brand"}],"city":{"name":"New York","lat":40.7306,"lon":-73.9866},"isSample":false}
```

### PUT /api/chain invalid (empty name)
`PUT /api/chain` -> HTTP 400
```
{"error":"body.name: Too small: expected string to have >=1 characters; body.brandVoice: Too small: expected array to have >=1 items; body.anchors: Too small: expected array to have >=1 items","code":"invalid_input"}
```

### GET /api/anchors/search?q=blue
`GET /api/anchors/search?q=blue` -> HTTP 200
```
[{"entityId":"1ce71098-a0fd-4319-888e-45e785880a34","name":"Blue Bottle Coffee","type":"urn:entity:brand"}]
```

### GET /api/anchors/search (missing q)
`GET /api/anchors/search` -> HTTP 400
```
{"error":"query.q: Invalid input: expected string, received undefined","code":"invalid_input"}
```

### POST /api/stores
`POST /api/stores` -> HTTP 200
```
{"id":"store_1h6y4g1v0e6o2024","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Greenpoint","addressLabel":"Manhattan Ave & Greenpoint Ave","lat":40.7295,"lon":-73.9544,"colorIndex":1}
```

### POST /api/stores invalid lat
`POST /api/stores` -> HTTP 400
```
{"error":"body.lat: Too big: expected number to be <=90","code":"invalid_input"}
```

### POST /api/stores/import (CSV, 8 rows)
`POST /api/stores/import` -> HTTP 200
```
[{"id":"store_476z506f3x6q4a4s","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Williamsburg","addressLabel":"Bedford Ave & N 7th St","lat":40.7175,"lon":-73.9573,"colorIndex":2},{"id":"store_453q1z3z2u2x196q","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Park Slope","addressLabel":"7th Ave & 9th St","lat":40.6683,"lon":-73.9806,"colorIndex":4},{"id":"store_173p1k5e426f733m","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Astoria","addressLabel":"30th Ave & 31st St","lat":40.7677,"lon":-73.9217,"colorIndex":6},{"id":"store_5j2y4i4o5f6p6i2w","chainId":"chain_kettle_kiln~1j6m0e70270b4t3t","name":"Harlem","addressLabel":"Frederick Douglass Blvd & W 116th St","lat":40.8037 ...[truncated]

```

### POST /api/stores/import bad CSV
`POST /api/stores/import` -> HTTP 400
```
{"error":"Row 2: lat must be a number from -90 to 90.","code":"invalid_csv"}
```

### DELETE /api/stores/:id (the added store)
`DELETE /api/stores/store_1h6y4g1v0e6o2024` -> HTTP 200
```
{"ok":true}
```

### DELETE /api/stores/:id unknown
`DELETE /api/stores/nope` -> HTTP 404
```
{"error":"Store not found.","code":"not_found"}
```

### GET /api/stores/:id/profile
`GET /api/stores/store_williamsburg~1j6m0e70270b4t3t/profile` -> HTTP 200
```
{"profile":{"storeId":"store_williamsburg~1j6m0e70270b4t3t","tags":[{"tagId":"urn:tag:menu_highlight:qloo:hojicha","name":"Hojicha","kind":"flavour","affinity":0.66,"lift":0.46},{"tagId":"urn:tag:genre:music:dream_pop","name":"Dream pop","kind":"music","affinity":0.74,"lift":0.44},{"tagId":"urn:tag:neighborhood_characteristic:qloo:arts_district","name":"Arts district","kind":"other","affinity":0.79,"lift":0.43},{"tagId":"urn:tag:menu_highlight:qloo:natural_wine","name":"Natural wine","kind":"flavour","affinity":0.7,"lift":0.42},{"tagId":"urn:tag:ambience:qloo:artsy","name":"Artsy","kind":"ambience","affinity":0.84,"lift":0.4},{"tagId":"urn:tag:ambience:qloo:bohemian","name":"Bohemian","kind" ...[truncated]

```

### GET /api/stores/:id/profile unknown store
`GET /api/stores/nope/profile` -> HTTP 404
```
{"error":"Store not found.","code":"not_found"}
```

### GET /api/compare?a=&b=
`GET /api/compare?a=store_williamsburg~1j6m0e70270b4t3t&b=store_park-slope~1j6m0e70270b4t3t` -> HTTP 200
```
{"result":{"a":"store_williamsburg~1j6m0e70270b4t3t","b":"store_park-slope~1j6m0e70270b4t3t","shared":[{"tagId":"urn:tag:menu_highlight:qloo:oat_milk","name":"Oat milk","kind":"flavour","affinity":0.65,"lift":0.23},{"tagId":"urn:tag:specialty_dish:place:sourdough_toast","name":"Sourdough toast","kind":"flavour","affinity":0.6,"lift":0.2}],"onlyA":[{"tagId":"urn:tag:genre:music:dream_pop","name":"Dream pop","kind":"music","affinity":0.74,"lift":0.44},{"tagId":"urn:tag:menu_highlight:qloo:hojicha","name":"Hojicha","kind":"flavour","affinity":0.66,"lift":0.46},{"tagId":"urn:tag:menu_highlight:qloo:natural_wine","name":"Natural wine","kind":"flavour","affinity":0.7,"lift":0.42},{"tagId":"urn:tag ...[truncated]

```

### GET /api/compare missing b
`GET /api/compare?a=store_williamsburg~1j6m0e70270b4t3t` -> HTTP 400
```
{"error":"query.b: Invalid input: expected string, received undefined","code":"invalid_input"}
```

### POST /api/menu/read (sample board png)
`POST /api/menu/read` -> HTTP 200
```
[{"id":"mi_2g2z146u3z1d4x1y","name":"Drip Coffee","category":"coffee","price":3.25,"currency":"USD","description":"Daily rotating single origin","source":"vl"},{"id":"mi_614e164t3g19631p","name":"Espresso","category":"coffee","price":3.5,"currency":"USD","description":null,"source":"vl"},{"id":"mi_5t0z3h3l4d4e295o","name":"Cortado","category":"coffee","price":4.25,"currency":"USD","description":"Equal parts espresso and steamed milk","source":"vl"},{"id":"mi_3f6m4s4y09701b6e","name":"Flat White","category":"coffee","price":4.75,"currency":"USD","description":null,"source":"vl"},{"id":"mi_6s1w5r224a5n3j52","name":"Oat Milk Latte","category":"coffee","price":5.5,"currency":"USD","description": ...[truncated]

```
x-le-mode: fixture

### POST /api/menu/read (phone photo png)
`POST /api/menu/read` -> HTTP 200
```
[{"id":"mi_0w235t0b0m4r3y2a","name":"Drip Coffee","category":"coffee","price":3.25,"currency":"USD","description":"Daily rotating single origin","source":"vl"},{"id":"mi_6z0e3g0c024a0f00","name":"Espresso","category":"coffee","price":3.5,"currency":"USD","description":null,"source":"vl"},{"id":"mi_4i12686y4z395k24","name":"Cortado","category":"coffee","price":4.25,"currency":"USD","description":"Equal parts espresso and steamed milk","source":"vl"},{"id":"mi_2p1q5g6c3n2s2m55","name":"Flat White","category":"coffee","price":4.75,"currency":"USD","description":null,"source":"vl"},{"id":"mi_5d015z1p325q3z6o","name":"Oat Milk Latte","category":"coffee","price":5.5,"currency":"USD","description": ...[truncated]

```

### POST /api/menu/read wrong type
`POST /api/menu/read` -> HTTP 400
```
{"error":"body.image: image must be jpg, png or webp","code":"invalid_input"}
```

### POST /api/menu/read non-image bytes as png
`POST /api/menu/read` -> HTTP 415
```
{"error":"The file is not a jpg, png or webp image.","code":"unsupported_image"}
```

### POST /api/menu/read >5 MB
`POST /api/menu/read` -> HTTP 400
```
{"error":"body.image: image must be 5 MB or smaller","code":"invalid_input"}
```

### PUT /api/menu (save the read items)
`PUT /api/menu` -> HTTP 200
```
[{"id":"mi_2g2z146u3z1d4x1y","name":"Drip Coffee","category":"coffee","price":3.25,"currency":"USD","description":"Daily rotating single origin","source":"vl"},{"id":"mi_614e164t3g19631p","name":"Espresso","category":"coffee","price":3.5,"currency":"USD","description":null,"source":"vl"},{"id":"mi_5t0z3h3l4d4e295o","name":"Cortado","category":"coffee","price":4.25,"currency":"USD","description":"Equal parts espresso and steamed milk","source":"vl"},{"id":"mi_3f6m4s4y09701b6e","name":"Flat White","category":"coffee","price":4.75,"currency":"USD","description":null,"source":"vl"},{"id":"mi_6s1w5r224a5n3j52","name":"Oat Milk Latte","category":"coffee","price":5.5,"currency":"USD","description": ...[truncated]

```

### GET /api/editions?weekOf= (before build)
`GET /api/editions` -> HTTP 200
```
[{"id":"ed_1g1x693r4i55733n~1j6m0e70270b4t3t","storeId":"store_williamsburg~1j6m0e70270b4t3t","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_18132d3v024i2l68","status":"draft","evidenceIds":["ev_to_sc6fw7","ev_024fda0eb55c26","ev_1c03fc490d1687"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":0,"kind":"special","baseMenuItemId":"menu_chai","name":"Masala Chai, Williamsburg edition","description":"Black tea simmered with ginger, cardamom and cinnamon, finished with milk. This week's pick for Williamsburg, where the block leans Black sesame.","flavourTags":["Black sesame"],"staffLine":"Try the Masala Chai. It is our Williamsbur ...[truncated]

```

## Part 2. Full edition build, streamed over SSE

### POST /api/editions/build (SSE, all 8 stores, fresh visitor workspace)
workspace: Kettle & Kiln (sample chain), stores=8, menu=22
`POST /api/editions/build` body `{}` -> HTTP 200 in 2 s; content-type: text/event-stream; charset=utf-8
event counts:
```
  32 guardrail
  32 item_drafted
   1 run_done
   1 run_started
   8 store_done
   8 store_started
  48 tool_call
  48 tool_result
```
contract check: events=178 invalid=0 (every event parsed with the AgentEvent zod schema)
first store, event sequence:
```
{"type":"store_started"}
{"type":"tool_call","tool":"block_profile"}
{"type":"tool_result","tool":"block_profile","ok":true,"summary":"12 tags over-index on this block"}
{"type":"tool_call","tool":"menu_match"}
{"type":"tool_result","tool":"menu_match","ok":true,"summary":"1 item and tag pairs, best Masala Chai with Black sesame (0.24)"}
{"type":"tool_call","tool":"places_near"}
{"type":"tool_result","tool":"places_near","ok":true,"summary":"12 places within reach"}
{"type":"tool_call","tool":"partners_rank"}
{"type":"tool_result","tool":"partners_rank","ok":true,"summary":"ranked 12 places by rerank, best Halfmoon Bakehouse"}
{"type":"tool_call","tool":"artists_local"}
{"type":"tool_result","tool":"artists_local","ok":true,"summary":"17 artists for the room"}
{"type":"tool_call","tool":"events_this_week"}
{"type":"tool_result","tool":"events_this_week","ok":true,"summary":"4 events this week"}
{"type":"item_drafted","itemKind":"special"}
{"type":"guardrail","g":"passed"}
{"type":"item_drafted","itemKind":"item"}
{"type":"guardrail","g":"passed"}
{"type":"item_drafted","itemKind":"item"}
{"type":"guardrail","g":"passed"}
{"type":"item_drafted","itemKind":"item"}
{"type":"guardrail","g":"passed"}
{"type":"store_done","editionId":"ed_1g1x693r4i55733n~66642b3p5q34184a"}
```
per store: items drafted and guardrail verdicts:
```
store_astoria: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_harlem: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_long-island-city: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_lower-east-side: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_park-slope: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_upper-east-side: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_west-village: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
store_williamsburg: special(passed,ev=3) sound(passed,ev=1) partner(passed,ev=2) event(passed,ev=1)
```
run_done: {"runId":"run_011h5s041p3r5t3k","editions":8}; error events: 0

## Part 3. Items, guardrails, regenerate, approve-all, staff card, jobs
edition under test: ed_1g1x693r4i55733n~66642b3p5q34184a (second edition ed_6d1y4w3g0u3k4e51~66642b3p5q34184a)

### GET /api/editions (latest week, after build)
`GET /api/editions` -> HTTP 200
```
[{"id":"ed_1g1x693r4i55733n~66642b3p5q34184a","storeId":"store_williamsburg~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_101w2u6e4v585817","status":"draft","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":0,"kind":"special","baseMenuItemId":"menu_chai","name":"Masala Chai, Williamsburg edition","description":"Black tea simmered with ginger, cardamom and cinnamon, finished with milk. This week's pick for Williamsburg, where the block leans Black sesame.","flavourTags":["Black sesame"],"staffLine":"Try the Masala Chai. It is our Williamsbur ...[truncated]

```
editions listed: 8

### GET /api/editions?weekOf=2026-11-02
`GET /api/editions?weekOf=2026-11-02` -> HTTP 200
```
[]
```
editions in week 2026-11-02: 0

### GET /api/editions?weekOf=bad
`GET /api/editions?weekOf=notadate` -> HTTP 400
```
{"error":"query.weekOf: Invalid ISO date","code":"invalid_input"}
```

### GET /api/editions/:id
`GET /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a` -> HTTP 200
```
{"id":"ed_1g1x693r4i55733n~66642b3p5q34184a","storeId":"store_williamsburg~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_101w2u6e4v585817","status":"draft","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":0,"kind":"special","baseMenuItemId":"menu_chai","name":"Masala Chai, Williamsburg edition","description":"Black tea simmered with ginger, cardamom and cinnamon, finished with milk. This week's pick for Williamsburg, where the block leans Black sesame.","flavourTags":["Black sesame"],"staffLine":"Try the Masala Chai. It is our Williamsburg pick this week."},{"id":"it_3j0w1l3z5904196p","status":"draft","evidenceIds":["ev_0d03f6396b2398"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"v ...[truncated]

```
{"id":"ed_1g1x693r4i55733n~66642b3p5q34184a","status":"draft","issueNo":1,"weekOf":"2026-10-26","items":[{"id":"it_101w2u6e4v585817","status":"draft","g":"passed"},{"id":"it_3j0w1l3z5904196p","status":"draft","g":"passed"},{"id":"it_6p1c525l2v1y571t","status":"draft","g":"passed"},{"id":"it_0x1x413g65346u42","status":"draft","g":"passed"}],"generatedBy":{"agentModel":"deterministic-plan","copyModel":"nvidia/Nemotron-3_5-Lightning","runId":"run_011h5s041p3r5t3k"}}
special=it_101w2u6e4v585817 sound=it_3j0w1l3z5904196p partner=it_6p1c525l2v1y571t event=it_0x1x413g65346u42

### GET /api/editions/:id unknown
`GET /api/editions/ed_nope` -> HTTP 404
```
{"error":"Edition not found.","code":"not_found"}
```

### PATCH item approve
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_3j0w1l3z5904196p` -> HTTP 200
```
{"id":"it_3j0w1l3z5904196p","status":"approved","evidenceIds":["ev_0d03f6396b2398"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":1,"kind":"sound","brief":"Keep the room Dream pop. Start with Beach House, Men I Trust, Japanese Breakfast and play artists in their orbit.","mood":"Dream pop","artists":[{"entityId":"025a6b44-f4a1-491e-85aa-90fe913f16d8","name":"Beach House","type":"urn:entity:artist"},{"entityId":"139052e3-3765-4b05-880a-c3e9ce6a0bff","name":"Men I Trust","type":"urn:entity:artist"},{"entityId":"1e10fa43-5015-4218-a345-99bb85260a43","name":"Japanese Breakfast","type":"urn:entity:artist"},{"entityId":"07210810-d7df-470 ...[truncated]

```

### PATCH item reject
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_6p1c525l2v1y571t` -> HTTP 200
```
{"id":"it_6p1c525l2v1y571t","status":"rejected","evidenceIds":["ev_14bbfa701d4c63","ev_to_100onpo"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":1,"kind":"partner","place":{"entityId":"175bddd6-53fa-4918-a78d-4dca7cc91a43","name":"Halfmoon Bakehouse","type":"urn:entity:place","address":"56 Berry St, Brooklyn","lat":40.716691,"lon":-73.958724,"distanceM":150},"reason":"Halfmoon Bakehouse is 150 m from the counter and shares the taste of Blue Bottle Coffee, Aesop, Muji.","offerIdea":"Swap counter cards: a flyer for Halfmoon Bakehouse here, one of ours there."}
```

### PATCH item edit (clean copy)
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_101w2u6e4v585817` -> HTTP 200
```
{"id":"it_101w2u6e4v585817","status":"edited","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"passed","reasons":[]},"version":1,"kind":"special","baseMenuItemId":"menu_chai","name":"Masala Chai, Williamsburg edition","description":"Black tea simmered with ginger, cardamom and cinnamon, finished with milk. This week's pick for Williamsburg, where the block leans Black sesame.","flavourTags":["Black sesame"],"staffLine":"Cardamom bun, baked at 6am. Ask for it warm."}
```

### PATCH item edit (health claim: trips guardrails)
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_101w2u6e4v585817` -> HTTP 200
```
{"id":"it_101w2u6e4v585817","status":"flagged","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not say something is good for you or for a part of the body. Matched \"good for you\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosts\".","Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar). Matched \"gluten-free\".","Allergen claim: copy may not mention allergens, allergies, intolerances or gluten. Matched \"gluten\"."],"rail":"check health claims","original":"A g ...[truncated]

```
guardrail verdict: {"status":"flagged","guardrail":{"status":"blocked","reasons":["Health claim: copy may not say something is good for you or for a part of the body. Matched \"good for you\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosts\".","Diet or allergen claim: no '-free' claims (gluten, dairy,

### PATCH item approve a blocked/flagged item (must refuse)
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_101w2u6e4v585817` -> HTTP 409
```
{"error":"Guardrails blocked this copy. Edit it so it passes before approving.","code":"guardrail_blocked"}
```

### PATCH item edit (identity targeting)
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_0x1x413g65346u42` -> HTTP 200
```
{"id":"it_0x1x413g65346u42","status":"flagged","evidenceIds":["ev_tv_2k55072c261n0e1m"],"guardrail":{"status":"blocked","reasons":["Identity targeting: copy may not address an age or gender group. Matched \"Perfect for young single women\".","Identity targeting: copy may not address an age band. Matched \"in their twenties\"."],"rail":"check health claims","original":"Perfect for young single women in their twenties."},"version":1,"kind":"event","title":"Listening night at Williamsburg","day":"Thu","time":"19:00","description":"Perfect for young single women in their twenties.","tieIn":{"title":"Ceramics opening at Salt Line Studio","url":"https://events.example.com/salt-line-studio-ceramics ...[truncated]

```

### PATCH item edit with stale If-Match
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_0x1x413g65346u42` -> HTTP 409
```
{"error":"This item changed in another tab. Reload and try again.","code":"version_conflict"}
```

### PATCH item invalid action
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_0x1x413g65346u42` -> HTTP 400
```
{"error":"body.action: Invalid discriminator value. Expected 'approve' | 'reject' | 'edit'","code":"invalid_input"}
```

### PATCH item unknown
`PATCH /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_nope` -> HTTP 404
```
{"error":"Item not found.","code":"not_found"}
```

### POST /api/editions/:id/items/:itemId/regenerate (SSE): the rejected partner
HTTP/1.1 200 OK
content-type: text/event-stream; charset=utf-8
```
{"type":"run_started"}
{"type":"store_started","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_call","tool":"block_profile","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_result","tool":"block_profile","ok":true,"summary":"12 tags over-index on this block","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_call","tool":"places_near","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_result","tool":"places_near","ok":true,"summary":"12 places within reach","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_call","tool":"partners_rank","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_result","tool":"partners_rank","ok":true,"summary":"ranked 12 places by rerank, best Halfmoon Bakehouse","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"item_drafted","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"guardrail","storeId":"store_williamsburg~66642b3p5q34184a","itemId":"it_6p1c525l2v1y571t"}
{"type":"store_done","storeId":"store_williamsburg~66642b3p5q34184a","editionId":"ed_1g1x693r4i55733n~66642b3p5q34184a"}
{"type":"run_done"}
```
events=12 invalid=0

### GET /api/editions/:id after regenerate
`GET /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a` -> HTTP 200
```
{"id":"ed_1g1x693r4i55733n~66642b3p5q34184a","storeId":"store_williamsburg~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_101w2u6e4v585817","status":"flagged","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not say something is good for you or for a part of the body. Matched \"good for you\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosts\".","Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar). Matched \"gluten-free\".","Allergen clai ...[truncated]

```
{"id":"it_6p1c525l2v1y571t","status":"draft","version":2,"place":"Low Tide Wine Bar","guardrail":"passed"}

### POST /api/editions/:id/items/:itemId/regenerate (SSE): the flagged special (single candidate in fixture mode)
HTTP/1.1 200 OK
content-type: text/event-stream; charset=utf-8
```
{"type":"run_started"}
{"type":"store_started","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_call","tool":"block_profile","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_result","tool":"block_profile","ok":true,"summary":"12 tags over-index on this block","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_call","tool":"menu_match","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"tool_result","tool":"menu_match","ok":true,"summary":"1 item and tag pairs, best Masala Chai with Black sesame (0.24)","storeId":"store_williamsburg~66642b3p5q34184a"}
{"type":"error","storeId":"store_williamsburg~66642b3p5q34184a","code":"no_alternative","message":"No new special candidate with evidence was found."}
```
events=7 invalid=0

### POST regenerate invalid body
`POST /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_3j0w1l3z5904196p/regenerate` -> HTTP 400
```
{"error":"body.hint: Invalid input: expected string, received number","code":"invalid_input"}
```

### POST regenerate unknown item
`POST /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/items/it_nope/regenerate` -> HTTP 404
```
{"error":"That item does not exist in this edition.","code":"item_not_found"}
```

### POST /api/editions/:id/approve-all
`POST /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a/approve-all` -> HTTP 200
```
{"id":"ed_1g1x693r4i55733n~66642b3p5q34184a","storeId":"store_williamsburg~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_101w2u6e4v585817","status":"flagged","evidenceIds":["ev_to_sc6fw7","ev_1117858397ef2b","ev_1d79350d5781b2"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not say something is good for you or for a part of the body. Matched \"good for you\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosts\".","Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar). Matched \"gluten-free\".","Allergen clai ...[truncated]

```
{"status":"flagged","items":[{"status":"flagged","g":"blocked"},{"status":"approved","g":"passed"},{"status":"approved","g":"passed"},{"status":"flagged","g":"blocked"}]}

### POST /api/editions/:id/approve-all (second edition, untouched)
`POST /api/editions/ed_6d1y4w3g0u3k4e51~66642b3p5q34184a/approve-all` -> HTTP 200
```
{"id":"ed_6d1y4w3g0u3k4e51~66642b3p5q34184a","storeId":"store_park-slope~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_6m1n2s29071t0k23","status":"approved","evidenceIds":["ev_to_1av4j48","ev_0484b5931f1c98","ev_0e5cbc1c6d7616"],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]},"version":1,"kind":"special","baseMenuItemId":"menu_banana-bread","name":"Banana Bread, Park Slope edition","description":"Thick slice with brown butter and a pinch of sea salt. This week's pick for Park Slope, where the block leans Brown butter.","flavourTags":["Brown butter"],"staffLine":"Try the Banana Bread. It is our Park Slope pick this wee ...[truncated]

```
{"status":"approved","items":[{"status":"approved","g":"passed"},{"status":"approved","g":"passed"},{"status":"approved","g":"passed"},{"status":"approved","g":"passed"}]}

### GET /api/editions/:id/card (generated on first request)
`GET /api/editions/ed_6d1y4w3g0u3k4e51~66642b3p5q34184a/card` -> HTTP 200
```
{"editionId":"ed_6d1y4w3g0u3k4e51~66642b3p5q34184a","storeId":"store_park-slope~66642b3p5q34184a","token":"005h4n6x0d0y09191q6z305b","lines":[{"heading":"This week's special","body":"Banana Bread, Park Slope edition. Try the Banana Bread. It is our Park Slope pick this week."},{"heading":"On the speakers","body":"Keep the room Family-friendly. Start with Big Thief, Fleet Foxes, Iron & Wine and play artists in their orbit."},{"heading":"Next door","body":"Little Acorn Books. Little Acorn Books is 72 m from the counter and shares the taste of Blue Bottle Coffee, Aesop, Muji. Swap counter cards: a flyer for Little Acorn Books here, one of ours there."},{"heading":"Event night","body":"Listening night at Park Slope, Thu at 19:00. A quiet evening in the shop timed to Canal film night in the library basement. The week's playlist, no agenda."}],"guardrail":{"status":"passed","reasons":["Skipped check brand voice: no model key configured."]}}
```
card guardrail: {"status":"passed","reasons":["Skipped check brand voice: no model key configured."]}  lines=4

### GET /api/editions/:id/card (second request, same token)
`GET /api/editions/ed_6d1y4w3g0u3k4e51~66642b3p5q34184a/card` -> HTTP 200
```
{"editionId":"ed_6d1y4w3g0u3k4e51~66642b3p5q34184a","storeId":"store_park-slope~66642b3p5q34184a","token":"005h4n6x0d0y09191q6z305b","lines":[{"heading":"This week's special","body":"Banana Bread, Park Slope edition. Try the Banana Bread. It is our Park Slope pick this week."},{"heading":"On the speakers","body":"Keep the room Family-friendly. Start with Big Thief, Fleet Foxes, Iron & Wine and play artists in their orbit."},{"heading":"Next door","body":"Little Acorn Books. Little Acorn Books is 72 m from the counter and shares the taste of Blue Bottle Coffee, Aesop, Muji. Swap counter cards: a flyer for Little Acorn Books here, one of ours there."},{"heading":"Event night","body":"Listening ...[truncated]

```
token stable: yes

### GET /api/card/:token (public) (no cookie)
`GET /api/card/005h4n6x0d0y09191q6z305b` -> HTTP 200
```
{"card":{"editionId":"ed_6d1y4w3g0u3k4e51~66642b3p5q34184a","storeId":"store_park-slope~66642b3p5q34184a","token":"005h4n6x0d0y09191q6z305b","lines":[{"heading":"This week's special","body":"Banana Bread, Park Slope edition. Try the Banana Bread. It is our Park Slope pick this week."},{"heading":"On the speakers","body":"Keep the room Family-friendly. Start with Big Thief, Fleet Foxes, Iron & Wine and play artists in their orbit."},{"heading":"Next door","body":"Little Acorn Books. Little Acorn Books is 72 m from the counter and shares the taste of Blue Bottle Coffee, Aesop, Muji. Swap counter cards: a flyer for Little Acorn Books here, one of ours there."},{"heading":"Event night","body":"Listening night at Park Slope, Thu at 19:00. A quiet evening in the shop timed to Canal film night in the library basement. The week's playlist, no agenda."}],"guardrail":{"status":"passed","reasons":[ ...[truncated]

```
public card keys: ["card","chainName","store"]

### GET /api/card/:token unknown (no cookie)
`GET /api/card/tok_nope` -> HTTP 404
```
{"error":"This staff card link is not valid.","code":"not_found"}
```

### GET /api/editions/:id (a stranger with no workspace cookie) (no cookie)
`GET /api/editions/ed_1g1x693r4i55733n~66642b3p5q34184a` -> HTTP 404
```
{"error":"Edition not found.","code":"not_found"}
```

### GET /api/stores/:id/profile (a stranger) (no cookie)
`GET /api/stores/store_williamsburg~66642b3p5q34184a/profile` -> HTTP 404
```
{"error":"Store not found.","code":"not_found"}
```

### POST /api/jobs/monday bad signature
`POST /api/jobs/monday` -> HTTP 401
```
{"error":"The request signature is not valid.","code":"bad_signature"}
```

### POST /api/jobs/monday no signature
`POST /api/jobs/monday` -> HTTP 400
```
{"error":"headers.x-le-signature: Invalid input: expected string, received undefined","code":"invalid_input"}
```

### POST /api/jobs/monday signed
`POST /api/jobs/monday` -> HTTP 200
```
{"id":"job_6n6h5f3m4y0g726o","trigger":"cron","startedAt":"2026-10-29T13:15:58.219Z","finishedAt":null,"storeIds":["store_williamsburg","store_park-slope","store_astoria","store_harlem","store_west-village","store_lower-east-side","store_upper-east-side","store_long-island-city"],"status":"running","nebiusJobId":null,"note":"Building 8 stores."}
```

### GET /api/jobs/latest
`GET /api/jobs/latest` -> HTTP 200
```
{"id":"job_6n6h5f3m4y0g726o","trigger":"cron","startedAt":"2026-10-29T13:15:58.219Z","finishedAt":"2026-10-29T13:16:00.002Z","storeIds":["store_williamsburg","store_park-slope","store_astoria","store_harlem","store_west-village","store_lower-east-side","store_upper-east-side","store_long-island-city"],"status":"done","nebiusJobId":null,"note":"Built 8 of 8 editions. Drafts await approval."}
```

### GET /api/status (after calls)
`GET /api/status` -> HTTP 200
```
{"qloo":"fixture","tokenfactory":"fixture","tavily":"fixture","guardrails":"up","spend":{"usd":0,"capUsd":5}}
```

## Guardrails sidecar stopped (degraded path)

### GET /api/status with the sidecar stopped
`GET /api/status` -> HTTP 200
```
{"qloo":"fixture","tokenfactory":"fixture","tavily":"fixture","guardrails":"down","spend":{"usd":0,"capUsd":5}}
```

### PATCH clean edit, guardrails down -> unchecked
`PATCH /api/editions/ed_3v3h0y1z2f5p5z3g~66642b3p5q34184a/items/it_545q0j720p5e2l64` -> HTTP 200
```
{"id":"it_545q0j720p5e2l64","status":"edited","evidenceIds":["ev_tv_6j255q43456p6t12"],"guardrail":{"status":"unchecked","reasons":["The guardrails server is unreachable.","The guardrails server was recently unreachable."]},"version":1,"kind":"event","title":"Listening night at Astoria","day":"Thu","time":"19:00","description":"Quiet evening, shared playlist.","tieIn":{"title":"Ditmars Street open studios","url":"https://events.example.com/ditmars-street-open-studios","source":"tavily"}}
```

### PATCH health-claim edit, guardrails down -> still blocked by the local catalogue
`PATCH /api/editions/ed_3v3h0y1z2f5p5z3g~66642b3p5q34184a/items/it_6v2i5l4e5k584n1u` -> HTTP 200
```
{"id":"it_6v2i5l4e5k584n1u","status":"flagged","evidenceIds":["ev_to_ohleor","ev_00a5a9a6e40335","ev_111d57c2d7bc4d"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not say a food or drink is healthy or good for wellbeing. Matched \"healthy\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosting\".","Checked locally only: the guardrails server was recently unreachable."],"rail":"local:claims","original":"Our healthy, immunity-boosting special."},"version":1,"kind":"special","baseMenuItemId":"menu_banana-bread","
```

### POST approve-all skips unchecked and flagged items
`POST /api/editions/ed_3v3h0y1z2f5p5z3g~66642b3p5q34184a/approve-all` -> HTTP 200
```
{"id":"ed_3v3h0y1z2f5p5z3g~66642b3p5q34184a","storeId":"store_astoria~66642b3p5q34184a","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_6v2i5l4e5k584n1u","status":"flagged","evidenceIds":["ev_to_ohleor","ev_00a5a9a6e40335","ev_111d57c2d7bc4d"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not say a food or drink is healthy or good for wellbeing. Matched \"healthy\".","Health claim: copy may not mention immunity. Matched \"immunity\".","Functional claim: copy may not say something boosts energy, mood or health. Matched \"boosting\".","Checked locally only: the guardrails server was recently unreachable."],"rail":"loca
```
{"status":"flagged","items":[{"status":"flagged","g":"blocked"},{"status":"approved","g":"passed"},{"status":"approved","g":"passed"},{"status":"edited","g":"unchecked"}]}
