const fs = require('fs');

const index0 = fs.readFileSync('style_index_0.css', 'utf8');
const index1 = fs.readFileSync('style_index_1.css', 'utf8').replace(/.*-->\s*<style>\s*/, '');
const quantri = fs.readFileSync('style_quantri.css', 'utf8');
const giaitrinh = fs.readFileSync('style_giaitrinh.css', 'utf8');

// Use simple regular expressions to extract logical chunks 
// or manually assemble them based on standard categories

let baseCss = `
/* ==========================================================================
   BASE STYLES & RESETS
   ========================================================================== */
:root {
  --primary: #1a73e8;
  --primary-hover: #1557b0;
  --bg-gray: #f8f9fa;
  --border-color: #dadce0;
}

* { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
html, body { height: 100%; }

body {
  font-family: 'Segoe UI', Arial, sans-serif;
  background-color: #f1f3f4; /* from quantri */
  background: #f0f4f8; /* from index */
  color: #333;
  /* Safe area cho iPhone notch */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

/* Custom Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #f1f3f4; }
::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }

/* Basic Form Elements */
input, select, textarea {
  font-family: inherit;
  outline: none;
}
`;

fs.writeFileSync('src/css/base.css', baseCss.trim() + '\n');
console.log('Created base.css');
