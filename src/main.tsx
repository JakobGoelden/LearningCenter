import { render } from 'preact';
import { App } from './ui/App';
import { registerPwa } from './pwa/register';
import './styles.css';

render(<App />, document.getElementById('app')!);
registerPwa();
