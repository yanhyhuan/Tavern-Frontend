import { startExtension } from './loader.js';

// Errors are reported by startExtension; avoid an unhandled rejection in the host.
void startExtension(window).catch(() => {});
