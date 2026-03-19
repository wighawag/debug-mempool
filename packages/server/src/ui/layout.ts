import {html, raw} from 'hono/html';
import type {HtmlEscapedString} from 'hono/utils/html';
import dashboardStyles from './static/dashboard.css.js';

export interface LayoutProps {
	title: string;
	children: HtmlEscapedString | Promise<HtmlEscapedString>;
}

export function layout({title, children}: LayoutProps) {
	return html`
		<!doctype html>
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>${title}</title>
				<script src="/ui/static/htmx.min.js"></script>
				<style>
					${raw(dashboardStyles)}
				</style>
			</head>
			<body>
				<header>
					<h1><span>⛧</span> Purgatory</h1>
				</header>
				${raw(children)}
				<!-- Atmospheric effects -->
				<div
					class="chain-line"
					style="transform:translateX(-50%) rotate(-12deg);"
				></div>
				<div
					class="chain-line"
					style="transform:translateX(-50%) rotate(12deg); opacity:0.4;"
				></div>
				<div
					class="chain-line"
					style="transform:translateX(-50%) rotate(0deg);"
				></div>
				<div class="vignette"></div>
				<div class="scanlines"></div>
			</body>
		</html>
	`;
}
