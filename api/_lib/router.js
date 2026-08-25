/* Picks which vlipa model answers a message.

   The visitor never chooses a model: they describe the job and the router
   sends it to the model built for that kind of work. Keywords are matched in
   English and Turkish. */

const RULES = [
  {
    alias: 'vlipa-build',
    reason: 'This is a website build, so it goes to the model that plans and writes sites.',
    words: ['website', 'web site', 'landing page', 'store', 'shop', 'storefront', 'theme',
            'site yap', 'web sitesi', 'mağaza', 'magaza', 'tema', 'açılış sayfası', 'vitrin',
            'e-ticaret', 'ecommerce', 'shopify'],
  },
  {
    alias: 'vlipa-code',
    reason: 'Code work, so it goes to the coding model.',
    words: ['code', 'function', 'bug', 'error', 'refactor', 'api', 'component', 'css', 'html',
            'javascript', 'python', 'sql', 'script', 'kod', 'hata', 'fonksiyon', 'derle',
            'yazılım', 'yazilim', 'düzelt', 'duzelt'],
  },
  {
    alias: 'vlipa-vision',
    reason: 'There is an image to read, so it goes to the vision model.',
    words: ['screenshot', 'image', 'photo', 'picture', 'ekran görüntüsü', 'görsel', 'gorsel',
            'fotoğraf', 'fotograf', 'resim'],
  },
  {
    alias: 'vlipa-think',
    reason: 'This needs planning, so it goes to the reasoning model.',
    words: ['plan', 'strategy', 'architecture', 'compare', 'decide', 'analyse', 'analyze',
            'why', 'strateji', 'mimari', 'karşılaştır', 'karsilastir', 'analiz', 'karar', 'neden'],
  },
  {
    alias: 'vlipa-write',
    reason: 'This is copy, so it goes to the writing model.',
    words: ['write', 'copy', 'headline', 'slogan', 'description', 'name', 'email', 'post',
            'yaz', 'metin', 'başlık', 'baslik', 'açıklama', 'aciklama', 'isim', 'içerik', 'icerik'],
  },
];

export function route(message, { hasImage = false, intent = '' } = {}) {
  if (hasImage) {
    return { alias: 'vlipa-vision', reason: 'An image came with the message, so the vision model takes it.' };
  }

  if (intent && RULES.some((rule) => rule.alias === intent)) {
    const rule = RULES.find((r) => r.alias === intent);
    return { alias: rule.alias, reason: rule.reason };
  }

  const text = String(message || '').toLowerCase();
  let best = null;

  for (const rule of RULES) {
    const hits = rule.words.filter((word) => text.includes(word)).length;
    if (hits && (!best || hits > best.hits)) best = { ...rule, hits };
  }

  if (!best) {
    return { alias: 'vlipa-fast', reason: 'A short general question, so the quick model answers.' };
  }

  return { alias: best.alias, reason: best.reason };
}
