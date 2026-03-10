const fs = require('fs');
const args = process.argv.slice(2);
for (const arg of args) {
	const cssFilePath = `./src/ui/static/${arg}.css`;
	const tsFilePath = `./src/ui/static/${arg}.css.ts`;
	const cssText = fs.readFileSync(cssFilePath, 'utf8');
	// Escape backticks and dollar signs in the content
	const escaped = cssText
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$/g, '\\$');
	fs.writeFileSync(tsFilePath, `export default \`${escaped}\`;`);
}
