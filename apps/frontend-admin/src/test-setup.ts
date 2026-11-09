import 'frontend-shared/test-setup';

import { createI18n } from './i18n/i18n.js';

// The tests read the interface in English, whatever the language of the machine they run on.
createI18n('en');

// jsdom does not lay out: the options of a select are not scrolled to.
HTMLElement.prototype.scrollIntoView = (): void => undefined;
