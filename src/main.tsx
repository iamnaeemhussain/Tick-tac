import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, loadPrefs } from './lib/settings';
import { primeAudio } from './lib/sound';
import './styles.css';

applyTheme(loadPrefs().theme);

// Unlock WebAudio on the first gesture (browser autoplay policy).
const prime = () => {
	primeAudio();
	window.removeEventListener('pointerdown', prime);
	window.removeEventListener('keydown', prime);
};
window.addEventListener('pointerdown', prime, { once: true });
window.addEventListener('keydown', prime, { once: true });

const rootEl = document.getElementById('root');
if (rootEl) {
	createRoot(rootEl).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
