// Seed list of employer job boards on public ATS feeds (Greenhouse, Lever, Ashby). All are free, keyless,
// official employer postings. Board tokens were checked on 2026-11-24; users can add their own in the workspace.
// stage: "startup" (<~500 people / early), "growth", "large". Tags drive the "robotics relevance" ranking priority.
module.exports = [
  // AI labs and AI-first companies
  { name: "Anthropic", ats: "greenhouse", board: "anthropic", stage: "growth", tags: ["ai"] },
  { name: "OpenAI", ats: "ashby", board: "openai", stage: "growth", tags: ["ai"] },
  { name: "xAI", ats: "greenhouse", board: "xai", stage: "growth", tags: ["ai"] },
  { name: "Cohere", ats: "ashby", board: "cohere", stage: "growth", tags: ["ai"] },
  { name: "Perplexity", ats: "ashby", board: "perplexity", stage: "growth", tags: ["ai"] },
  { name: "Scale AI", ats: "greenhouse", board: "scaleai", stage: "growth", tags: ["ai"] },
  { name: "Together AI", ats: "greenhouse", board: "togetherai", stage: "startup", tags: ["ai"] },
  { name: "ElevenLabs", ats: "ashby", board: "elevenlabs", stage: "growth", tags: ["ai"] },
  { name: "Harvey", ats: "ashby", board: "harvey", stage: "growth", tags: ["ai"] },
  { name: "Glean", ats: "greenhouse", board: "gleanwork", stage: "growth", tags: ["ai"] },
  { name: "Cursor", ats: "ashby", board: "cursor", stage: "startup", tags: ["ai"] },
  { name: "Replit", ats: "ashby", board: "replit", stage: "startup", tags: ["ai"] },
  { name: "Decagon", ats: "ashby", board: "decagon", stage: "startup", tags: ["ai"] },
  { name: "Sierra", ats: "ashby", board: "sierra", stage: "startup", tags: ["ai"] },
  { name: "Mercor", ats: "ashby", board: "mercor", stage: "startup", tags: ["ai"] },
  { name: "Pika", ats: "ashby", board: "pika", stage: "startup", tags: ["ai"] },
  { name: "Databricks", ats: "greenhouse", board: "databricks", stage: "large", tags: ["ai"] },
  // Robotics and autonomy
  { name: "Physical Intelligence", ats: "ashby", board: "physicalintelligence", stage: "startup", tags: ["ai", "robotics"] },
  { name: "Figure AI", ats: "greenhouse", board: "figureai", stage: "startup", tags: ["ai", "robotics"] },
  { name: "1X", ats: "ashby", board: "1x", stage: "startup", tags: ["ai", "robotics"] },
  { name: "Agility Robotics", ats: "greenhouse", board: "agilityrobotics", stage: "startup", tags: ["robotics"] },
  { name: "Formic", ats: "greenhouse", board: "formic", stage: "startup", tags: ["robotics"] },
  { name: "Waymo", ats: "greenhouse", board: "waymo", stage: "large", tags: ["ai", "robotics"] },
  { name: "Nuro", ats: "greenhouse", board: "nuro", stage: "growth", tags: ["ai", "robotics"] },
  { name: "Zoox", ats: "lever", board: "zoox", stage: "large", tags: ["ai", "robotics"] },
  // Software / fintech with strong product and GTM teams
  { name: "Palantir", ats: "lever", board: "palantir", stage: "large", tags: ["ai"] },
  { name: "Stripe", ats: "greenhouse", board: "stripe", stage: "large", tags: [] },
  { name: "Ramp", ats: "ashby", board: "ramp", stage: "growth", tags: ["ai"] },
  { name: "Notion", ats: "ashby", board: "notion", stage: "growth", tags: [] },
  { name: "Linear", ats: "ashby", board: "linear", stage: "startup", tags: [] },
  { name: "Robinhood", ats: "greenhouse", board: "robinhood", stage: "large", tags: [] },
];
