const { processImage } = require('./main.js');
const fs = require('fs');
const childProcess = require('child_process');

async function test() {
    try {
        console.log("Generating sample test image (5712x4284)...");
        // Using PNG since we just need to test dimension behavior
        childProcess.execSync("magick -size 5712x4284 canvas:black test_img.png");
        
        console.log("Running processImage...");
        const thumbs = await processImage('test_img.png');
        
        console.log("Thumbs generated:");
        for (const [type, path] of Object.entries(thumbs)) {
            const out = childProcess.execSync(`identify ${path}`).toString();
            console.log(`- ${type}: ${out.trim()}`);
        }
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
test();
