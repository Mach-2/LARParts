// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
	output: 'static',
	// Preserve Astro 6 inline whitespace instead of Astro 7's JSX default.
	compressHTML: true,
	adapter: netlify({cacheOnDemandPages:false,imageCDN:false,devFeatures:false}),
});
