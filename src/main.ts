import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app mount point missing');

const app = new App({
  target,
  props: { startScreen: 'login', density: 'Dense', maskEmails: false }
});

export default app;
