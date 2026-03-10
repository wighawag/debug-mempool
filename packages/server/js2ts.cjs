const fs = require('fs');
const args = process.argv.slice(2);
for (const arg of args) {
	const jsFilePath = `./src/ui/static/${arg}.js`;
	const tsFilePath = `./src/ui/static/${arg}.js.ts`;
	const jsText = fs.readFileSync(jsFilePath, 'utf8');
	// Escape backticks and dollar signs in the content
	const escaped = jsText
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$/g, '\\$');
	fs.writeFileSync(tsFilePath, `export default \`${escaped}\`;`);
}
