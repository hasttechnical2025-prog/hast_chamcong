const fs = require('fs');

function extractByLines(htmlFile, jsFile, startLine, endLine) {
  const lines = fs.readFileSync(htmlFile, 'utf8').split('\n');
  // lines are 0-indexed, so line N is index N-1.
  // We want lines from startLine+1 to endLine-1 (just the body)
  const scriptBody = lines.slice(startLine, endLine - 1).join('\n');
  fs.writeFileSync(jsFile, scriptBody, 'utf8');
  console.log(`Extracted lines ${startLine}-${endLine} of ${htmlFile} to ${jsFile}`);
}

extractByLines('quantri/index.html', 'quantri_script.js', 641, 2384);
extractByLines('giaitrinh/index.html', 'giaitrinh_script.js', 231, 1632);
