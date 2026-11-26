// BASE_URL defaults to Shawty's live host; override for staging.
process.env.BASE_URL ??= "https://grin-veil-8450.onpagelove.com";

export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.mjs"],
  format: ["progress-bar", "summary"],
  // Network calls to a real host: give each step room.
  parallel: 0,
};
