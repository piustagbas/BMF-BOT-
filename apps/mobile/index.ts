import { Buffer } from 'buffer';
import { registerRootComponent } from 'expo';

import App from './App';

if (!(globalThis as unknown as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

registerRootComponent(App);
