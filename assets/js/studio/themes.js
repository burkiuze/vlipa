/* Free themes.

   Every theme is an original design: a palette, a type pairing and a starting
   set of sections. They are shaped for the kinds of stores that show up in
   "best Shopify stores" round-ups (skincare, outdoor gear, coffee, fashion,
   electronics, jewellery, furniture, plants, streetwear, home textiles) but
   none of them copy another shop's code or artwork. */

export const THEMES = [
  {
    id: 'aurora', name: 'Aurora', for: 'Skincare & beauty',
    palette: { bg: '#fffaf7', surface: '#ffffff', text: '#241a1a', muted: '#7a6a68',
               line: '#f0e2dc', accent: '#e0715c', accentText: '#ffffff', dark: '#2a1c1a' },
    fonts: { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
    radius: '18px', hero: 'split',
  },
  {
    id: 'atlas', name: 'Atlas', for: 'Outdoor & gear',
    palette: { bg: '#f6f6f3', surface: '#ffffff', text: '#15201c', muted: '#5c6a63',
               line: '#e2e5df', accent: '#1f6f4a', accentText: '#ffffff', dark: '#10201a' },
    fonts: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
    radius: '6px', hero: 'full',
  },
  {
    id: 'nectar', name: 'Nectar', for: 'Coffee & food',
    palette: { bg: '#fdf8ef', surface: '#ffffff', text: '#2a1f14', muted: '#7b6a55',
               line: '#eee1cd', accent: '#a5622b', accentText: '#ffffff', dark: '#241a11' },
    fonts: { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
    radius: '14px', hero: 'center',
  },
  {
    id: 'muse', name: 'Muse', for: 'Fashion',
    palette: { bg: '#ffffff', surface: '#fafafa', text: '#0c0c0c', muted: '#6a6a6a',
               line: '#e8e8e8', accent: '#0c0c0c', accentText: '#ffffff', dark: '#0c0c0c' },
    fonts: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
    radius: '0px', hero: 'full',
  },
  {
    id: 'volt', name: 'Volt', for: 'Electronics & tech',
    palette: { bg: '#08080f', surface: '#12121f', text: '#f4f4ff', muted: '#a0a0c0',
               line: '#23233a', accent: '#4f46ff', accentText: '#ffffff', dark: '#08080f' },
    fonts: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
    radius: '16px', hero: 'center', dark: true,
  },
  {
    id: 'lumen', name: 'Lumen', for: 'Jewellery',
    palette: { bg: '#0f0e12', surface: '#17161c', text: '#f6f1e8', muted: '#b5ab9c',
               line: '#2a2731', accent: '#c9a227', accentText: '#14120c', dark: '#0f0e12' },
    fonts: { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
    radius: '4px', hero: 'split', dark: true,
  },
  {
    id: 'terra', name: 'Terra', for: 'Plants & garden',
    palette: { bg: '#f7faf5', surface: '#ffffff', text: '#17251a', muted: '#5f7062',
               line: '#e0e9dd', accent: '#3f7d3a', accentText: '#ffffff', dark: '#16251a' },
    fonts: { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
    radius: '22px', hero: 'split',
  },
  {
    id: 'forge', name: 'Forge', for: 'Furniture & craft',
    palette: { bg: '#f4f2ef', surface: '#ffffff', text: '#1c1a17', muted: '#6b645c',
               line: '#e3ded6', accent: '#b4522b', accentText: '#ffffff', dark: '#1c1a17' },
    fonts: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
    radius: '8px', hero: 'full',
  },
  {
    id: 'court', name: 'Court', for: 'Sneakers & streetwear',
    palette: { bg: '#ffffff', surface: '#f5f5f7', text: '#111114', muted: '#63636e',
               line: '#e6e6ec', accent: '#ff4d2d', accentText: '#ffffff', dark: '#111114' },
    fonts: { display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" },
    radius: '26px', hero: 'center',
  },
  {
    id: 'kilim', name: 'Kilim', for: 'Home & textiles',
    palette: { bg: '#fbf7f2', surface: '#ffffff', text: '#26201b', muted: '#7a6d61',
               line: '#ece2d6', accent: '#7a5c3e', accentText: '#ffffff', dark: '#26201b' },
    fonts: { display: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif" },
    radius: '12px', hero: 'split',
  },
];

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

/* Section types the editor can add. */
export const SECTION_TYPES = [
  { type: 'hero', label: 'Hero', note: 'Headline, a line of text and buttons.' },
  { type: 'features', label: 'Features', note: 'Three to six short selling points.' },
  { type: 'products', label: 'Products', note: 'A grid of items with a price.' },
  { type: 'gallery', label: 'Gallery', note: 'A row of photographs.' },
  { type: 'about', label: 'About', note: 'A paragraph next to an image.' },
  { type: 'quote', label: 'Quote', note: 'One customer sentence, large.' },
  { type: 'faq', label: 'FAQ', note: 'Questions and answers.' },
  { type: 'cta', label: 'Call to action', note: 'A closing block with a button.' },
];

export function blankSection(type) {
  const id = 's' + Math.random().toString(36).slice(2, 9);

  const presets = {
    hero: {
      eyebrow: 'New season',
      title: 'A shop that looks like it was made on purpose.',
      text: 'One line about what you sell and why someone should care.',
      primary: 'Shop now', secondary: 'Our story', image: '',
    },
    features: {
      title: 'Why people come back',
      items: [
        { title: 'Made in small batches', text: 'Nothing sits in a warehouse for a year.' },
        { title: 'Free returns', text: 'Thirty days, no questions, no restocking fee.' },
        { title: 'Shipped in a day', text: 'Orders before 4pm leave the same afternoon.' },
      ],
    },
    products: {
      title: 'Best sellers',
      items: [
        { name: 'Product one', price: '₺450', note: 'Two colours', image: '' },
        { name: 'Product two', price: '₺620', note: 'Limited run', image: '' },
        { name: 'Product three', price: '₺380', note: 'Restocked', image: '' },
      ],
    },
    gallery: { title: 'In the wild', images: [] },
    about: {
      title: 'We started in a kitchen.',
      text: 'Two paragraphs about how the shop began, who makes the work and what you refuse to compromise on.',
      image: '',
    },
    quote: { text: 'I have bought this three times and given two of them away.', author: 'A customer' },
    faq: {
      title: 'Questions',
      items: [
        { q: 'How long does shipping take?', a: 'Two to four working days inside the country.' },
        { q: 'Can I return something?', a: 'Within thirty days, unused, in its box.' },
      ],
    },
    cta: { title: 'Ready when you are.', text: 'A short closing line.', button: 'Shop the collection' },
  };

  return { id, type, props: presets[type] || {} };
}

export function starterSite(themeId, name) {
  const theme = themeById(themeId);

  return {
    name: name || `${theme.name} store`,
    theme: theme.id,
    brand: name || `${theme.name} store`,
    sections: [
      blankSection('hero'),
      blankSection('features'),
      blankSection('products'),
      blankSection('about'),
      blankSection('cta'),
    ],
  };
}
