import type { StoreEditionSpec } from "./edition-spec";

/** Stores 1-4. Partner places are invented; artists are real. All sample data. */
export const editionSpecsA: Record<string, StoreEditionSpec> = {
  williamsburg: {
    special: {
      baseMenuSlug: "cortado",
      name: "Orange Peel Cortado",
      description: "Our cortado with a twist of fresh orange peel and a pinch of dark chocolate. Bright up front, round at the finish.",
      flavourTags: ["orange peel", "dark chocolate", "fig jam"],
      staffLine: "If someone asks what is different, say the peel is cut fresh each morning.",
    },
    sound: {
      brief: "Loose, guitar-led records that sound better the louder the room gets. Keep it low until noon, then let it climb.",
      mood: "Jangly, unhurried, a little scuffed",
      artists: ["Big Thief", "Mac DeMarco", "Yo La Tengo", "Parquet Courts", "Beach House", "Wednesday", "Alex G", "Japanese Breakfast", "Real Estate", "The War on Drugs"],
    },
    partner: {
      name: "Tern & Tallow Vintage",
      address: "112 Bedford Ave, Brooklyn, NY",
      dLat: 0.0009, dLon: -0.0006,
      reason: "A vintage shop two minutes away whose customers match the block's love of thrifting and old records.",
      offerIdea: "Show a Tern & Tallow receipt, get a dollar off any cortado. We pin a shop card by our register in return.",
    },
    event: {
      title: "Vinyl and Cortado Night",
      day: "Thu", time: "19:00",
      description: "Neighbours bring one record to play. We pour cortados and keep the volume where people can still talk.",
      tieIn: { title: "Williamsburg record fair returns to the waterfront this weekend", url: "https://example.com/events/williamsburg-record-fair" },
    },
  },
  "park-slope": {
    special: {
      baseMenuSlug: "banana-bread",
      name: "Brown Butter Banana Loaf",
      description: "Our banana bread, toasted and finished with brown butter and a little flaky salt. Made for a slow Saturday.",
      flavourTags: ["brown butter", "flaky salt", "walnut"],
      staffLine: "Offer it warm. Ask whether they want a second slice wrapped for later.",
    },
    sound: {
      brief: "Soft folk and singer-songwriters at conversation volume. Strollers and book clubs should never have to raise a voice.",
      mood: "Warm, acoustic, unhurried",
      artists: ["Joni Mitchell", "Fleet Foxes", "Gregory Alan Isakov", "Phoebe Bridgers", "Iron & Wine", "Nick Drake", "Brandi Carlile", "Bon Iver", "Sufjan Stevens", "Hozier"],
    },
    partner: {
      name: "Ninth Street Page & Spine",
      address: "9th St near 6th Ave, Brooklyn, NY",
      dLat: -0.0004, dLon: 0.0014,
      reason: "An independent bookshop a short walk away, and the block reads at about three times the city rate.",
      offerIdea: "Tuck a free cookie into every Page & Spine bag on Saturdays. They hand out our brew-at-home card.",
    },
    event: {
      title: "Saturday Story Hour and Pastry",
      day: "Sat", time: "10:30",
      description: "A neighbour reads to the little ones for twenty minutes while parents have a quiet coffee. Pastries at half price for the hour.",
      tieIn: { title: "Grand Army Plaza Greenmarket opens its autumn season", url: "https://example.com/events/grand-army-greenmarket" },
    },
  },
  astoria: {
    special: {
      baseMenuSlug: "iced-latte",
      name: "Honey Sesame Frappe Latte",
      description: "Iced latte shaken until frothy with a spoon of honey and a pinch of toasted sesame. A nod to the neighbourhood's long summers.",
      flavourTags: ["honey", "toasted sesame", "frappe"],
      staffLine: "Shake it, do not stir it. The foam is the point.",
      status: "flagged",
      guardrail: {
        status: "rewritten",
        rail: "no-health-claims",
        reasons: ["Removed a claim that the drink boosts energy."],
        original: "Honey sesame iced latte packed with natural energy to power your afternoon.",
      },
    },
    sound: {
      brief: "Mediterranean pop and bouzouki-flavoured records for the afternoon rush, then something slower once the beer garden fills.",
      mood: "Sunlit, rhythmic, communal",
      artists: ["Haris Alexiou", "Anna Vissi", "Sakis Rouvas", "Natasa Theodoridou", "Giorgos Dalaras", "Tamer Hosny", "Rita", "Yasmine Hamdan", "Omar Souleyman", "Elena Paparizou"],
    },
    partner: {
      name: "Athena's Sweet Corner",
      address: "31st St near 30th Ave, Astoria, NY",
      dLat: 0.0007, dLon: 0.0004,
      reason: "A family pastry counter that shares our regulars and fills the gap on baklava and loukoumades.",
      offerIdea: "Co-sell a coffee and baklava pair for one price on Sundays. Each shop displays the other's menu.",
    },
    event: {
      title: "Sunday Sidewalk Sessions",
      day: "Sun", time: "16:00",
      description: "Local musicians play on the corner while the beer garden opens next door. Iced coffees go first, so we keep extra ice on hand.",
      tieIn: { title: "Astoria Park summer concert series adds Sunday dates", url: "https://example.com/events/astoria-park-concerts" },
    },
  },
  harlem: {
    special: {
      baseMenuSlug: "chai",
      name: "Sweet Potato Spice Chai",
      description: "Our masala chai with a spoon of roasted sweet potato and extra cinnamon. Soft, spiced and a little sweet.",
      flavourTags: ["sweet potato", "cinnamon", "ginger"],
      staffLine: "Tell people it is the same recipe the kitchen staff drinks on cold mornings.",
    },
    sound: {
      brief: "Jazz and soul through the afternoon, with a live-sounding warmth. Turn it up a notch after 4 pm when the block comes home.",
      mood: "Rich, warm, rolling",
      artists: ["Nina Simone", "Miles Davis", "Ella Fitzgerald", "Gil Scott-Heron", "Alice Coltrane", "Erykah Badu", "Marvin Gaye", "Cassandra Wilson", "Thelonious Monk", "Norah Jones", "Esperanza Spalding"],
    },
    partner: {
      name: "Strivers Row Record Room",
      address: "W 117th St near Frederick Douglass Blvd, New York, NY",
      dLat: 0.0006, dLon: 0.0009,
      reason: "A record shop the block's jazz listeners already visit on weekends, a three-minute walk away.",
      offerIdea: "Feature one Record Room pick on our speakers each week, with a card at the counter pointing to the shop.",
    },
    event: {
      title: "Open Mic and Chai Night",
      day: "Wed", time: "19:30",
      description: "Poets and singers sign up at the counter. We pour chai from a big pot and keep the lights low.",
      tieIn: { title: "Harlem Week lineup announced with free outdoor stages", url: "https://example.com/events/harlem-week-lineup" },
    },
  },
};
