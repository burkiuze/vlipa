/* Tool calling: the functions Vlipa can reach for.

   To add a capability: describe it in `toolDefinitions`, then handle it in
   `executeTool`. The model sees only the description and decides when to ask. */

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Şu anki tarih ve saati (İstanbul saatiyle) döndürür. Kullanıcı saat veya tarih sorduğunda kullan.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vlipa_info',
      description:
        'vlipa yazılım stüdyosu hakkında bilgi döndürür (hizmetler, çalışma süreci, ilkeler, teknoloji). ' +
        'Kullanıcı vlipa\'nın ne yaptığını, nasıl çalıştığını veya hangi teknolojileri kullandığını sorduğunda kullan.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['services', 'process', 'principles', 'stack'],
            description: 'İstenen bilginin konusu',
          },
        },
        required: ['topic'],
      },
    },
  },
];

const VLIPA_INFO = {
  services:
    'vlipa altı alanda çalışır: özel yazılım (web, mobil, kurumsal panel, API), otomasyon ve yapay zeka, ' +
    'UI/UX tasarım, e-ticaret (vitrin, stok, ödeme, ERP entegrasyonu), altyapı (bulut, CI/CD, izleme, yedekleme) ' +
    've veri (veri ambarı, panolar, raporlama).',
  process:
    'Proje dört aşamada ilerler. Discovery: süreci yerinde dinleriz ve nerede tıkandığını yazarız. ' +
    'Scope: kapsam, takvim ve fiyat işe başlamadan önce yazılı olarak netleşir. ' +
    'Build: iki haftalık turlar, her turun sonunda tıklanabilir bir sürüm. ' +
    'Launch & Care: geçiş, eğitim, devir ve sonrasında bakım.',
  principles:
    'Dört ilke: tahminden önce net kapsam; her iki haftada bir çalışan yazılım; kaynak kod, sunucu ve ' +
    'hesapların ilk günden müşterinin adına olması; yayın sonrası bakımın işin parçası sayılması.',
  stack:
    'Ürün tarafı: TypeScript, React, Next.js, React Native, Flutter. Servis: Node.js, Python, .NET, Laravel, ' +
    'REST ve GraphQL. Veri: PostgreSQL, MSSQL, Redis, ClickHouse, Metabase. Platform: Docker, AWS, Azure, ' +
    'GitHub Actions, Grafana.',
};

export async function executeTool(name, args = {}) {
  switch (name) {
    case 'get_current_time':
      return new Intl.DateTimeFormat('tr-TR', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Europe/Istanbul',
      }).format(new Date());

    case 'get_vlipa_info':
      return VLIPA_INFO[String(args.topic || 'services')] || VLIPA_INFO.services;

    default:
      return `Bilinmeyen araç: ${name}`;
  }
}
