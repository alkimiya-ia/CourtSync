import { getLanguage, setLanguage, useLanguage } from '../lib/i18n';

/** Compact, accessible language control for the home screen and game views. */
export default function LanguageSwitch() {
  useLanguage();
  return (
    <div className="language-switch" role="group" aria-label="Idioma / Language">
      <button type="button" aria-pressed={getLanguage() === 'es'} onClick={() => setLanguage('es')}>ES</button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={getLanguage() === 'en'} onClick={() => setLanguage('en')}>EN</button>
    </div>
  );
}
