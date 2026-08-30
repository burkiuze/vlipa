/* The homepage in somebody's own language.

   The page is written in English and stays that way in the file: that is what
   a search engine reads, and what somebody with JavaScript switched off gets.
   Translation happens over the top of it.

   There are no keys to invent. A translation file is a map from the English
   sentence to its translation, so a line reads the way the page reads and
   nothing has to be kept in step by hand:

     'What we do': 'Ne yapıyoruz',

   Anything a file does not mention stays in English — which is how product
   names (Vlipa Studio, Nebius, Tavily) are left alone: by not being there.

   Each language is a file of its own under assets/i18n/, fetched only when
   somebody picks it. Forty languages in one bundle would be a download every
   visitor pays for and almost nobody uses. */

/* Written in their own language, because a person looking for their language
   is not reading the one they are trying to leave. */
export const LANGUAGES = [
  { code: 'en',  name: 'English' },
  { code: 'tr',  name: 'Türkçe' },
  { code: 'de',  name: 'Deutsch' },
  { code: 'es',  name: 'Español' },
  { code: 'fr',  name: 'Français' },
  { code: 'it',  name: 'Italiano' },
  { code: 'pt',  name: 'Português' },
  { code: 'nl',  name: 'Nederlands' },
  { code: 'pl',  name: 'Polski' },
  { code: 'ru',  name: 'Русский' },
  { code: 'uk',  name: 'Українська' },
  { code: 'cs',  name: 'Čeština' },
  { code: 'sk',  name: 'Slovenčina' },
  { code: 'hu',  name: 'Magyar' },
  { code: 'ro',  name: 'Română' },
  { code: 'bg',  name: 'Български' },
  { code: 'el',  name: 'Ελληνικά' },
  { code: 'sv',  name: 'Svenska' },
  { code: 'no',  name: 'Norsk' },
  { code: 'da',  name: 'Dansk' },
  { code: 'fi',  name: 'Suomi' },
  { code: 'et',  name: 'Eesti' },
  { code: 'lv',  name: 'Latviešu' },
  { code: 'lt',  name: 'Lietuvių' },
  { code: 'hr',  name: 'Hrvatski' },
  { code: 'sr',  name: 'Srpski' },
  { code: 'sl',  name: 'Slovenščina' },
  { code: 'sq',  name: 'Shqip' },
  { code: 'az',  name: 'Azərbaycanca' },
  { code: 'ka',  name: 'ქართული' },
  { code: 'hy',  name: 'Հայերեն' },
  { code: 'ar',  name: 'العربية' },
  { code: 'he',  name: 'עברית' },
  { code: 'fa',  name: 'فارسی' },
  { code: 'ur',  name: 'اردو' },
  { code: 'hi',  name: 'हिन्दी' },
  { code: 'bn',  name: 'বাংলা' },
  { code: 'ta',  name: 'தமிழ்' },
  { code: 'zh',  name: '中文' },
  { code: 'ja',  name: '日本語' },
  { code: 'ko',  name: '한국어' },
  { code: 'vi',  name: 'Tiếng Việt' },
  { code: 'th',  name: 'ไทย' },
  { code: 'id',  name: 'Bahasa Indonesia' },
  { code: 'ms',  name: 'Bahasa Melayu' },
  { code: 'sw',  name: 'Kiswahili' },
];

/* The ones that run right to left. */
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const KEPT = 'vlipa.lang';
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
const ATTRS = ['alt', 'title', 'placeholder', 'aria-label'];

const loaded = new Map([['en', {}]]);
let spots = null;

const tidy = (text) => text.replace(/\s+/g, ' ').trim();

/* Every place on the page that holds a sentence, with the English kept beside
   it. Keeping the original means switching from Japanese to Greek reads the
   English first and never translates a translation. */
function survey() {
  const found = [];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (SKIP.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
      return tidy(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // The whitespace on either side is layout, not language: "<b>one</b> two"
    // loses the gap if the whole node is replaced.
    const [, lead, core, tail] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
    found.push({ set: (text) => { node.nodeValue = lead + text + tail; }, en: core, key: tidy(core) });
  }

  for (const element of document.querySelectorAll(`[${ATTRS.join('],[')}]`)) {
    for (const attr of ATTRS) {
      const value = element.getAttribute(attr);
      if (!value || !tidy(value)) continue;

      found.push({ set: (text) => element.setAttribute(attr, text), en: value, key: tidy(value) });
    }
  }

  const description = document.querySelector('meta[name="description"]');

  found.push({ set: (text) => { document.title = text; }, en: document.title, key: tidy(document.title) });
  if (description) {
    found.push({
      set: (text) => description.setAttribute('content', text),
      en: description.content,
      key: tidy(description.content),
    });
  }

  return found;
}

async function dictionary(code) {
  if (loaded.has(code)) return loaded.get(code);

  try {
    const words = (await import(`../i18n/${code}.js`)).default;
    loaded.set(code, words);
    return words;
  } catch (error) {
    // A language that will not load is one language, not a broken page.
    console.warn(`[vlipa] ${code} could not be loaded:`, error.message);
    loaded.set(code, {});
    return {};
  }
}

export async function speak(code) {
  const known = LANGUAGES.some((one) => one.code === code) ? code : 'en';
  const words = await dictionary(known);

  spots ||= survey();
  for (const spot of spots) spot.set(words[spot.key] ?? spot.en);

  document.documentElement.lang = known;
  document.documentElement.dir = RTL.has(known) ? 'rtl' : 'ltr';

  try {
    localStorage.setItem(KEPT, known);
  } catch { /* a browser that refuses storage still gets the language */ }

  return known;
}

/* What was chosen last time; failing that, what the browser asks for; failing
   that, the language the page is already in. */
export function preferred() {
  try {
    const kept = localStorage.getItem(KEPT);
    if (kept && LANGUAGES.some((one) => one.code === kept)) return kept;
  } catch { /* fall through to the browser's own preference */ }

  for (const tag of navigator.languages || [navigator.language || '']) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (LANGUAGES.some((one) => one.code === code)) return code;
  }

  return 'en';
}

/* ---------- the picker in the bar ---------- */

function build(root, current) {
  const button = root.querySelector('.lang__btn');
  const menu = root.querySelector('.lang__menu');
  const now = root.querySelector('.lang__now');

  const draw = (code) => {
    now.textContent = LANGUAGES.find((one) => one.code === code)?.name || 'English';

    for (const option of menu.children) {
      option.setAttribute('aria-selected', String(option.dataset.code === code));
    }
  };

  for (const language of LANGUAGES) {
    const option = document.createElement('button');

    option.type = 'button';
    option.role = 'option';
    option.className = 'lang__opt';
    option.dataset.code = language.code;
    option.textContent = language.name;
    option.lang = language.code;

    option.addEventListener('click', async () => {
      draw(await speak(language.code));
      close();
    });

    menu.append(option);
  }

  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('click', (event) => { if (!root.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });

  draw(current);
}

const root = document.getElementById('lang');

if (root) {
  const code = preferred();

  build(root, code);
  if (code !== 'en') speak(code);
}
