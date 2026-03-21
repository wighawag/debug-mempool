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
				<script>
					// Memory leak prevention: Stop animations before HTMX swaps out elements
					// This ensures proper garbage collection of replaced DOM nodes
					document.addEventListener('htmx:beforeSwap', function(evt) {
						var target = evt.detail.target;
						if (target) {
							// Recursively stop animations on all child elements
							var elements = target.querySelectorAll('*');
							for (var i = 0; i < elements.length; i++) {
								elements[i].style.animation = 'none';
							}
							target.style.animation = 'none';
						}
					});

					// Pause polling when tab is not visible to save resources
					document.addEventListener('visibilitychange', function() {
						if (document.hidden) {
							// Pause HTMX polling by removing hx-trigger temporarily
							htmx.findAll('[hx-trigger*="every"]').forEach(function(el) {
								el.setAttribute('data-hx-trigger-paused', el.getAttribute('hx-trigger'));
								el.removeAttribute('hx-trigger');
								htmx.process(el);
							});
						} else {
							// Resume HTMX polling
							htmx.findAll('[data-hx-trigger-paused]').forEach(function(el) {
								el.setAttribute('hx-trigger', el.getAttribute('data-hx-trigger-paused'));
								el.removeAttribute('data-hx-trigger-paused');
								htmx.process(el);
							});
						}
					});
				</script>
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
