import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// vitePreprocess enables <script lang="ts"> in .svelte files.
export default { preprocess: vitePreprocess() };
