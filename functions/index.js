// Cloud Functions entry point.
// Firebase loads this file (package.json "main") and deploys every exported
// function. The actual implementations live in placesIndex.js — we just
// re-export them here so the file layout stays tidy.
module.exports = require("./placesIndex");
