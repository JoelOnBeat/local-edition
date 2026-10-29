import type { StoreEditionSpec } from "./edition-spec";

/** Stores 5-8. Partner places are invented; artists are real. All sample data. */
export const editionSpecsB: Record<string, StoreEditionSpec> = {
  "west-village": {
    special: {
      baseMenuSlug: "almond-croissant",
      name: "Lavender Honey Almond Croissant",
      description: "Our almond croissant with a thread of lavender honey and a dusting of sugar. Fragrant, buttery and best eaten warm.",
      flavourTags: ["lavender", "honey", "toasted almond"],
      staffLine: "Offer a flat white alongside; it is the pairing our regulars choose.",
    },
    sound: {
      brief: "Small-club jazz and French chanson, kept low enough that the poetry crowd can hear each other.",
      mood: "Candlelit, intimate, a touch wistful",
      artists: ["Chet Baker", "Bill Evans", "Édith Piaf", "Madeleine Peyroux", "Django Reinhardt", "Stan Getz", "Françoise Hardy", "Nina Simone", "Charles Aznavour", "Diana Krall"],
      status: "approved",
    },
    partner: {
      name: "Christopher Street Cellar & Cheese",
      address: "Christopher St near Bleecker St, New York, NY",
      dLat: 0.0003, dLon: -0.0005,
      reason: "A tiny cellar with a cheese counter whose evening crowd overlaps ours at closing time.",
      offerIdea: "Pair a cheese plate with our almond croissant for a Friday afternoon box, sold at both counters.",
    },
    event: {
      title: "Thursday Poetry and Pastry",
      day: "Thu", time: "18:30",
      description: "Four readers, four minutes each, followed by the last of the day's croissants. Seats go fast, so we hold a few at the door.",
      tieIn: { title: "Village poetry festival announces fall readings along Bleecker", url: "https://example.com/events/village-poetry-festival" },
    },
  },
  "lower-east-side": {
    special: {
      baseMenuSlug: "mocha",
      name: "Black Sesame Mocha",
      description: "Our mocha made with house chocolate and a swirl of black sesame paste. Dark, nutty and not too sweet.",
      flavourTags: ["black sesame", "dark chocolate", "salt"],
      staffLine: "If they want it less sweet, halve the chocolate and leave the sesame.",
      status: "approved",
    },
    sound: {
      brief: "Post-punk and garage records, loud enough to feel it and low enough to order over. Afternoons only.",
      mood: "Abrasive, fast, fond of feedback",
      artists: ["Television", "Sleater-Kinney", "Idles", "The Strokes", "Interpol", "Yeah Yeah Yeahs", "Fontaines D.C.", "Parquet Courts", "Protomartyr", "Wet Leg"],
    },
    partner: {
      name: "Rivington Zine & Print Co.",
      address: "Rivington St near Orchard St, New York, NY",
      dLat: 0.0002, dLon: 0.0008,
      reason: "A zine and print shop where the block's late-night crowd hangs out. It shares our shelf-life of weird, small things.",
      offerIdea: "Print a limited run of our weekly menu as a zine at their counter. Customers who buy one get a free drip coffee.",
    },
    event: {
      title: "Zine Swap Night",
      day: "Wed", time: "20:00",
      description: "Bring a zine, take a zine. We pour late-night mochas until the shelves are empty.",
      tieIn: { title: "Lower East Side gallery weekend kicks off with free studio visits", url: "https://example.com/events/les-gallery-weekend" },
    },
  },
  "upper-east-side": {
    special: {
      baseMenuSlug: "matcha",
      name: "Earl Grey Matcha Latte",
      description: "Matcha latte infused with a gentle hint of bergamot. Quiet, fragrant and well suited to a slow afternoon.",
      flavourTags: ["bergamot", "matcha", "vanilla"],
      staffLine: "Serve it in the wide cup. People like to hold it with both hands.",
      status: "approved",
    },
    sound: {
      brief: "Solo piano and chamber music at a whisper. The reading tables near the window should feel like a library.",
      mood: "Hushed, unfolding, spacious",
      artists: ["Ludovico Einaudi", "Max Richter", "Nils Frahm", "Yiruma", "Jóhann Jóhannsson", "Erik Satie", "Claude Debussy", "Ólafur Arnalds", "Hania Rani", "Philip Glass"],
      status: "approved",
    },
    partner: {
      name: "Lexington Print & Frame Gallery",
      address: "Lexington Ave near E 77th St, New York, NY",
      dLat: -0.0005, dLon: 0.0004,
      reason: "A small gallery and frame shop whose openings bring in the same museum-goers that stop in for tea.",
      offerIdea: "Host a tea table at their Thursday openings. They hang one local print in our window each month.",
    },
    event: {
      title: "Afternoon Tea Tasting",
      day: "Fri", time: "15:00",
      description: "Three teas, three pastries, one table. A staff member walks guests through the pairings.",
      tieIn: { title: "Museum Mile festival returns with extended gallery hours", url: "https://example.com/events/museum-mile-festival" },
      status: "approved",
    },
  },
  "long-island-city": {
    special: {
      baseMenuSlug: "nitro",
      name: "Grapefruit Nitro Cold Brew",
      description: "Nitro cold brew topped with a splash of fresh grapefruit shrub. Crisp, cold and made for a walk along the water.",
      flavourTags: ["grapefruit", "shrub", "cold brew"],
      staffLine: "Pour it slowly so the foam settles. Hand it over with a napkin; the glass is cold.",
    },
    sound: {
      brief: "Mellow electronic and house, steady and unobtrusive. Good background for laptops and long phone calls.",
      mood: "Steady, glassy, modern",
      artists: ["Bonobo", "Floating Points", "Four Tet", "Caribou", "Jon Hopkins", "Kaytranada", "Moderat", "Tycho", "Jamie xx", "Overmono"],
      guardrail: { status: "unchecked", reasons: ["Guardrails were unreachable; this item needs a manual check before approval."] },
    },
    partner: {
      name: "Vernon Blvd Climbing Studio",
      address: "Vernon Blvd near 48th Ave, Long Island City, NY",
      dLat: 0.0008, dLon: 0.0003,
      reason: "A climbing studio with a morning crowd that leaves right as our laptop crowd arrives.",
      offerIdea: "Give climbers a post-session cold brew for half price when they show a studio wristband.",
    },
    event: {
      title: "Waterfront Walk and Coffee",
      day: "Sat", time: "09:00",
      description: "We start at the store, walk the Gantry Plaza path and come back for a pour-over. Free for anyone with a mug.",
      tieIn: { title: "Gantry Plaza State Park schedules fall art installations", url: "https://example.com/events/gantry-plaza-art" },
    },
  },
};
