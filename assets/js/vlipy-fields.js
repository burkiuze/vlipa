/* What is inside a sector, and what it is worked with.

   Picking "Software" is not enough to write a course from: somebody learning
   cyber security and somebody learning web development share almost nothing.
   So after the sector Vlipy asks two more questions — which parts of it, and
   which tools or languages — and both take as many answers as you like.

   Every entry carries its English name, which is what the course prompt is
   given, and a Turkish one where the name is a real word rather than a
   product. Anything without a translation is a proper noun and stays put:
   Kubernetes is Kubernetes in every language on earth. */

const FIELDS = {
  software: {
    areas: [
      { id: 'web', emoji: '🌐', en: 'Web development', tr: 'Web geliştirme' },
      { id: 'mobile', emoji: '📱', en: 'Mobile apps', tr: 'Mobil uygulamalar' },
      { id: 'security', emoji: '🛡️', en: 'Cyber security', tr: 'Siber güvenlik' },
      { id: 'data', emoji: '📊', en: 'Data and analytics', tr: 'Veri ve analitik' },
      { id: 'ai', emoji: '🤖', en: 'Machine learning', tr: 'Makine öğrenmesi' },
      { id: 'devops', emoji: '⚙️', en: 'DevOps and cloud', tr: 'DevOps ve bulut' },
      { id: 'games', emoji: '🎮', en: 'Game development', tr: 'Oyun geliştirme' },
      { id: 'embedded', emoji: '🔌', en: 'Embedded systems', tr: 'Gömülü sistemler' },
      { id: 'testing', emoji: '🧪', en: 'Testing and quality', tr: 'Test ve kalite' },
      { id: 'architecture', emoji: '🏛️', en: 'Software architecture', tr: 'Yazılım mimarisi' },
    ],
    tools: [
      { id: 'python', emoji: '🐍', en: 'Python' },
      { id: 'js', emoji: '🟨', en: 'JavaScript' },
      { id: 'ts', emoji: '🔷', en: 'TypeScript' },
      { id: 'cpp', emoji: '⚡', en: 'C++' },
      { id: 'csharp', emoji: '🎯', en: 'C#' },
      { id: 'rust', emoji: '🦀', en: 'Rust' },
      { id: 'go', emoji: '🐹', en: 'Go' },
      { id: 'java', emoji: '☕', en: 'Java' },
      { id: 'sql', emoji: '🗄️', en: 'SQL' },
      { id: 'react', emoji: '⚛️', en: 'React' },
      { id: 'docker', emoji: '🐳', en: 'Docker' },
      { id: 'kubernetes', emoji: '🚢', en: 'Kubernetes' },
      { id: 'linux', emoji: '🐧', en: 'Linux' },
      { id: 'git', emoji: '🌿', en: 'Git' },
    ],
  },

  energy: {
    areas: [
      { id: 'solar', emoji: '☀️', en: 'Solar power', tr: 'Güneş enerjisi' },
      { id: 'wind', emoji: '💨', en: 'Wind power', tr: 'Rüzgâr enerjisi' },
      { id: 'grid', emoji: '🔌', en: 'Grid and distribution', tr: 'Şebeke ve dağıtım' },
      { id: 'storage', emoji: '🔋', en: 'Batteries and storage', tr: 'Batarya ve depolama' },
      { id: 'oilgas', emoji: '🛢️', en: 'Oil and gas', tr: 'Petrol ve gaz' },
      { id: 'nuclear', emoji: '⚛️', en: 'Nuclear power', tr: 'Nükleer enerji' },
      { id: 'efficiency', emoji: '📉', en: 'Energy efficiency', tr: 'Enerji verimliliği' },
      { id: 'trading', emoji: '📈', en: 'Energy trading', tr: 'Enerji ticareti' },
      { id: 'hse', emoji: '🦺', en: 'Safety and environment', tr: 'İş güvenliği ve çevre' },
    ],
    tools: [
      { id: 'scada', emoji: '🖥️', en: 'SCADA' },
      { id: 'pvsyst', emoji: '☀️', en: 'PVsyst' },
      { id: 'etap', emoji: '⚡', en: 'ETAP' },
      { id: 'homer', emoji: '🏠', en: 'HOMER' },
      { id: 'autocad', emoji: '📐', en: 'AutoCAD' },
      { id: 'iec', emoji: '📋', en: 'IEC standards', tr: 'IEC standartları' },
      { id: 'plc', emoji: '🎛️', en: 'PLC control', tr: 'PLC kontrol' },
      { id: 'excel', emoji: '📊', en: 'Excel modelling', tr: 'Excel modelleme' },
    ],
  },

  finance: {
    areas: [
      { id: 'accounting', emoji: '🧾', en: 'Accounting', tr: 'Muhasebe' },
      { id: 'banking', emoji: '🏦', en: 'Banking', tr: 'Bankacılık' },
      { id: 'markets', emoji: '📈', en: 'Markets and trading', tr: 'Piyasalar ve alım satım' },
      { id: 'credit', emoji: '💳', en: 'Credit and lending', tr: 'Kredi ve borç verme' },
      { id: 'audit', emoji: '🔍', en: 'Audit and compliance', tr: 'Denetim ve uyum' },
      { id: 'corporate', emoji: '🏢', en: 'Corporate finance', tr: 'Kurumsal finans' },
      { id: 'insurance', emoji: '☂️', en: 'Insurance', tr: 'Sigortacılık' },
      { id: 'tax', emoji: '📑', en: 'Tax', tr: 'Vergi' },
      { id: 'fintech', emoji: '📲', en: 'Fintech and payments', tr: 'Fintek ve ödemeler' },
    ],
    tools: [
      { id: 'excel', emoji: '📊', en: 'Excel and modelling', tr: 'Excel ve modelleme' },
      { id: 'ifrs', emoji: '📕', en: 'IFRS' },
      { id: 'sap', emoji: '🗂️', en: 'SAP' },
      { id: 'bloomberg', emoji: '💹', en: 'Bloomberg Terminal' },
      { id: 'powerbi', emoji: '📉', en: 'Power BI' },
      { id: 'sql', emoji: '🗄️', en: 'SQL' },
      { id: 'python', emoji: '🐍', en: 'Python' },
      { id: 'quickbooks', emoji: '📗', en: 'QuickBooks' },
    ],
  },

  health: {
    areas: [
      { id: 'nursing', emoji: '💉', en: 'Nursing care', tr: 'Hemşirelik' },
      { id: 'clinic', emoji: '🏥', en: 'Running a clinic', tr: 'Klinik işletmek' },
      { id: 'pharma', emoji: '💊', en: 'Pharmaceuticals', tr: 'İlaç' },
      { id: 'devices', emoji: '🩻', en: 'Medical devices', tr: 'Tıbbi cihazlar' },
      { id: 'labs', emoji: '🧫', en: 'Laboratory work', tr: 'Laboratuvar' },
      { id: 'records', emoji: '🗃️', en: 'Patient records', tr: 'Hasta kayıtları' },
      { id: 'public', emoji: '🌍', en: 'Public health', tr: 'Halk sağlığı' },
      { id: 'emergency', emoji: '🚑', en: 'Emergency care', tr: 'Acil bakım' },
    ],
    tools: [
      { id: 'hl7', emoji: '🔗', en: 'HL7 and FHIR' },
      { id: 'icd', emoji: '🏷️', en: 'ICD coding', tr: 'ICD kodlama' },
      { id: 'emr', emoji: '💻', en: 'Electronic records', tr: 'Elektronik kayıt sistemleri' },
      { id: 'gmp', emoji: '🧼', en: 'GMP' },
      { id: 'iso13485', emoji: '📋', en: 'ISO 13485' },
      { id: 'spss', emoji: '📊', en: 'SPSS' },
      { id: 'firstaid', emoji: '⛑️', en: 'First aid protocols', tr: 'İlk yardım protokolleri' },
    ],
  },

  construction: {
    areas: [
      { id: 'site', emoji: '👷', en: 'Site management', tr: 'Şantiye yönetimi' },
      { id: 'structural', emoji: '🏗️', en: 'Structural work', tr: 'Yapısal işler' },
      { id: 'mep', emoji: '🔧', en: 'Mechanical and electrical', tr: 'Mekanik ve elektrik' },
      { id: 'estimating', emoji: '🧮', en: 'Costing and estimating', tr: 'Maliyet ve keşif' },
      { id: 'planning', emoji: '🗓️', en: 'Planning and scheduling', tr: 'Planlama ve programlama' },
      { id: 'safety', emoji: '🦺', en: 'Site safety', tr: 'İş güvenliği' },
      { id: 'finishing', emoji: '🎨', en: 'Finishing trades', tr: 'İnce işler' },
      { id: 'contracts', emoji: '📜', en: 'Contracts and claims', tr: 'Sözleşme ve hakediş' },
    ],
    tools: [
      { id: 'autocad', emoji: '📐', en: 'AutoCAD' },
      { id: 'revit', emoji: '🏢', en: 'Revit and BIM' },
      { id: 'primavera', emoji: '📅', en: 'Primavera P6' },
      { id: 'msproject', emoji: '🗂️', en: 'MS Project' },
      { id: 'sap2000', emoji: '🧱', en: 'SAP2000 / ETABS' },
      { id: 'fidic', emoji: '📜', en: 'FIDIC contracts', tr: 'FIDIC sözleşmeleri' },
      { id: 'survey', emoji: '📍', en: 'Surveying instruments', tr: 'Ölçüm aletleri' },
    ],
  },

  manufacturing: {
    areas: [
      { id: 'production', emoji: '🏭', en: 'Production planning', tr: 'Üretim planlama' },
      { id: 'quality', emoji: '✅', en: 'Quality control', tr: 'Kalite kontrol' },
      { id: 'maintenance', emoji: '🔧', en: 'Maintenance', tr: 'Bakım' },
      { id: 'automation', emoji: '🦾', en: 'Automation and robotics', tr: 'Otomasyon ve robotik' },
      { id: 'lean', emoji: '📉', en: 'Lean and continuous improvement', tr: 'Yalın üretim' },
      { id: 'design', emoji: '✏️', en: 'Product design', tr: 'Ürün tasarımı' },
      { id: 'supply', emoji: '📦', en: 'Supply and purchasing', tr: 'Tedarik ve satın alma' },
      { id: 'safety', emoji: '🦺', en: 'Workplace safety', tr: 'İş güvenliği' },
    ],
    tools: [
      { id: 'solidworks', emoji: '🧩', en: 'SolidWorks' },
      { id: 'catia', emoji: '📐', en: 'CATIA' },
      { id: 'sap', emoji: '🗂️', en: 'SAP' },
      { id: 'plc', emoji: '🎛️', en: 'PLC and SCADA' },
      { id: 'sixsigma', emoji: '📊', en: 'Six Sigma' },
      { id: 'iso9001', emoji: '📋', en: 'ISO 9001' },
      { id: 'cnc', emoji: '⚙️', en: 'CNC machining', tr: 'CNC işleme' },
      { id: 'minitab', emoji: '📈', en: 'Minitab' },
    ],
  },

  logistics: {
    areas: [
      { id: 'warehouse', emoji: '🏬', en: 'Warehousing', tr: 'Depo yönetimi' },
      { id: 'freight', emoji: '🚚', en: 'Road freight', tr: 'Kara taşımacılığı' },
      { id: 'shipping', emoji: '🚢', en: 'Sea and air freight', tr: 'Deniz ve hava taşımacılığı' },
      { id: 'customs', emoji: '🛃', en: 'Customs and trade', tr: 'Gümrük ve dış ticaret' },
      { id: 'stock', emoji: '📦', en: 'Stock and inventory', tr: 'Stok yönetimi' },
      { id: 'lastmile', emoji: '🛵', en: 'Last mile delivery', tr: 'Son kilometre teslimat' },
      { id: 'planning', emoji: '🗺️', en: 'Route planning', tr: 'Rota planlama' },
      { id: 'cold', emoji: '❄️', en: 'Cold chain', tr: 'Soğuk zincir' },
    ],
    tools: [
      { id: 'wms', emoji: '🖥️', en: 'Warehouse systems', tr: 'Depo yönetim sistemleri' },
      { id: 'sap', emoji: '🗂️', en: 'SAP' },
      { id: 'incoterms', emoji: '📜', en: 'Incoterms' },
      { id: 'excel', emoji: '📊', en: 'Excel' },
      { id: 'tms', emoji: '🚛', en: 'Transport systems', tr: 'Taşıma yönetim sistemleri' },
      { id: 'barcode', emoji: '🏷️', en: 'Barcode and RFID' },
      { id: 'powerbi', emoji: '📈', en: 'Power BI' },
    ],
  },

  retail: {
    areas: [
      { id: 'ecommerce', emoji: '🛒', en: 'E-commerce', tr: 'E-ticaret' },
      { id: 'store', emoji: '🏪', en: 'Store operations', tr: 'Mağaza operasyonu' },
      { id: 'buying', emoji: '🧾', en: 'Buying and merchandising', tr: 'Satın alma ve ürün yönetimi' },
      { id: 'marketing', emoji: '📣', en: 'Marketing and campaigns', tr: 'Pazarlama ve kampanyalar' },
      { id: 'service', emoji: '💬', en: 'Customer service', tr: 'Müşteri hizmetleri' },
      { id: 'pricing', emoji: '🏷️', en: 'Pricing', tr: 'Fiyatlandırma' },
      { id: 'visual', emoji: '🪟', en: 'Visual merchandising', tr: 'Görsel düzenleme' },
      { id: 'analytics', emoji: '📊', en: 'Retail analytics', tr: 'Perakende analitiği' },
    ],
    tools: [
      { id: 'shopify', emoji: '🛍️', en: 'Shopify' },
      { id: 'ga4', emoji: '📈', en: 'Google Analytics' },
      { id: 'meta', emoji: '📣', en: 'Meta Ads' },
      { id: 'pos', emoji: '💳', en: 'POS systems', tr: 'Kasa sistemleri' },
      { id: 'excel', emoji: '📊', en: 'Excel' },
      { id: 'crm', emoji: '🤝', en: 'CRM systems', tr: 'CRM sistemleri' },
      { id: 'seo', emoji: '🔎', en: 'SEO' },
    ],
  },

  agriculture: {
    areas: [
      { id: 'crops', emoji: '🌾', en: 'Crop growing', tr: 'Bitkisel üretim' },
      { id: 'livestock', emoji: '🐄', en: 'Livestock', tr: 'Hayvancılık' },
      { id: 'greenhouse', emoji: '🏡', en: 'Greenhouses', tr: 'Seracılık' },
      { id: 'soil', emoji: '🪱', en: 'Soil and fertiliser', tr: 'Toprak ve gübreleme' },
      { id: 'irrigation', emoji: '💧', en: 'Irrigation', tr: 'Sulama' },
      { id: 'machinery', emoji: '🚜', en: 'Farm machinery', tr: 'Tarım makineleri' },
      { id: 'organic', emoji: '🍃', en: 'Organic farming', tr: 'Organik tarım' },
      { id: 'agritech', emoji: '🛰️', en: 'Agritech and sensors', tr: 'Tarım teknolojisi' },
    ],
    tools: [
      { id: 'gis', emoji: '🗺️', en: 'GIS mapping', tr: 'GIS haritalama' },
      { id: 'drones', emoji: '🚁', en: 'Drones', tr: 'Dronlar' },
      { id: 'soiltest', emoji: '🧪', en: 'Soil testing', tr: 'Toprak analizi' },
      { id: 'globalgap', emoji: '📋', en: 'GLOBALG.A.P.' },
      { id: 'weather', emoji: '🌦️', en: 'Weather stations', tr: 'Meteoroloji istasyonları' },
      { id: 'excel', emoji: '📊', en: 'Excel' },
    ],
  },

  tourism: {
    areas: [
      { id: 'hotel', emoji: '🏨', en: 'Hotel management', tr: 'Otel yönetimi' },
      { id: 'frontdesk', emoji: '🛎️', en: 'Front desk', tr: 'Ön büro' },
      { id: 'food', emoji: '🍽️', en: 'Food and beverage', tr: 'Yiyecek ve içecek' },
      { id: 'travel', emoji: '✈️', en: 'Travel agency work', tr: 'Seyahat acenteciliği' },
      { id: 'guiding', emoji: '🧭', en: 'Guiding', tr: 'Rehberlik' },
      { id: 'events', emoji: '🎪', en: 'Events and MICE', tr: 'Etkinlik ve kongre' },
      { id: 'revenue', emoji: '📈', en: 'Revenue management', tr: 'Gelir yönetimi' },
      { id: 'digital', emoji: '📲', en: 'Online sales', tr: 'Çevrimiçi satış' },
    ],
    tools: [
      { id: 'opera', emoji: '🏨', en: 'Opera PMS' },
      { id: 'amadeus', emoji: '✈️', en: 'Amadeus' },
      { id: 'booking', emoji: '🌐', en: 'Booking.com Extranet' },
      { id: 'channel', emoji: '🔗', en: 'Channel managers', tr: 'Kanal yöneticileri' },
      { id: 'haccp', emoji: '🧼', en: 'HACCP' },
      { id: 'excel', emoji: '📊', en: 'Excel' },
    ],
  },

  education: {
    areas: [
      { id: 'classroom', emoji: '🧑‍🏫', en: 'Classroom teaching', tr: 'Sınıf içi öğretim' },
      { id: 'curriculum', emoji: '📚', en: 'Curriculum design', tr: 'Müfredat tasarımı' },
      { id: 'online', emoji: '💻', en: 'Online learning', tr: 'Çevrimiçi öğrenme' },
      { id: 'assessment', emoji: '📝', en: 'Assessment', tr: 'Ölçme ve değerlendirme' },
      { id: 'special', emoji: '🤝', en: 'Special education', tr: 'Özel eğitim' },
      { id: 'earlyyears', emoji: '🧸', en: 'Early years', tr: 'Okul öncesi' },
      { id: 'corporate', emoji: '🏢', en: 'Corporate training', tr: 'Kurumsal eğitim' },
      { id: 'management', emoji: '🏫', en: 'School management', tr: 'Okul yönetimi' },
    ],
    tools: [
      { id: 'moodle', emoji: '🎓', en: 'Moodle' },
      { id: 'classroom', emoji: '📗', en: 'Google Classroom' },
      { id: 'canvas', emoji: '🖼️', en: 'Canvas LMS' },
      { id: 'scorm', emoji: '📦', en: 'SCORM' },
      { id: 'articulate', emoji: '🎬', en: 'Articulate Storyline' },
      { id: 'kahoot', emoji: '🎯', en: 'Kahoot' },
    ],
  },

  media: {
    areas: [
      { id: 'video', emoji: '🎬', en: 'Video production', tr: 'Video prodüksiyon' },
      { id: 'editing', emoji: '✂️', en: 'Editing and post', tr: 'Kurgu ve post prodüksiyon' },
      { id: 'design', emoji: '🎨', en: 'Graphic design', tr: 'Grafik tasarım' },
      { id: 'writing', emoji: '✍️', en: 'Writing and editorial', tr: 'Yazarlık ve editörlük' },
      { id: 'social', emoji: '📱', en: 'Social media', tr: 'Sosyal medya' },
      { id: 'advertising', emoji: '📣', en: 'Advertising', tr: 'Reklamcılık' },
      { id: 'photo', emoji: '📷', en: 'Photography', tr: 'Fotoğrafçılık' },
      { id: 'audio', emoji: '🎙️', en: 'Audio and podcasting', tr: 'Ses ve podcast' },
    ],
    tools: [
      { id: 'premiere', emoji: '🎞️', en: 'Premiere Pro' },
      { id: 'davinci', emoji: '🎨', en: 'DaVinci Resolve' },
      { id: 'photoshop', emoji: '🖌️', en: 'Photoshop' },
      { id: 'figma', emoji: '🔺', en: 'Figma' },
      { id: 'aftereffects', emoji: '✨', en: 'After Effects' },
      { id: 'illustrator', emoji: '✏️', en: 'Illustrator' },
      { id: 'audition', emoji: '🎚️', en: 'Audition' },
    ],
  },

  law: {
    areas: [
      { id: 'contracts', emoji: '📜', en: 'Contract law', tr: 'Sözleşme hukuku' },
      { id: 'corporate', emoji: '🏢', en: 'Corporate law', tr: 'Şirketler hukuku' },
      { id: 'labour', emoji: '👷', en: 'Employment law', tr: 'İş hukuku' },
      { id: 'ip', emoji: '💡', en: 'Intellectual property', tr: 'Fikri mülkiyet' },
      { id: 'data', emoji: '🔐', en: 'Data protection', tr: 'Kişisel verilerin korunması' },
      { id: 'litigation', emoji: '⚖️', en: 'Litigation', tr: 'Dava ve icra' },
      { id: 'compliance', emoji: '✅', en: 'Compliance', tr: 'Uyum' },
      { id: 'property', emoji: '🏠', en: 'Property law', tr: 'Gayrimenkul hukuku' },
    ],
    tools: [
      { id: 'gdpr', emoji: '🔐', en: 'GDPR and KVKK' },
      { id: 'drafting', emoji: '✍️', en: 'Contract drafting', tr: 'Sözleşme kaleme alma' },
      { id: 'research', emoji: '🔎', en: 'Legal research', tr: 'Hukuki araştırma' },
      { id: 'uyap', emoji: '🏛️', en: 'Case management systems', tr: 'Dava takip sistemleri' },
      { id: 'duediligence', emoji: '📋', en: 'Due diligence' },
    ],
  },

  automotive: {
    areas: [
      { id: 'mechanics', emoji: '🔧', en: 'Vehicle mechanics', tr: 'Araç mekaniği' },
      { id: 'electric', emoji: '🔋', en: 'Electric vehicles', tr: 'Elektrikli araçlar' },
      { id: 'electronics', emoji: '💡', en: 'Vehicle electronics', tr: 'Araç elektroniği' },
      { id: 'production', emoji: '🏭', en: 'Vehicle production', tr: 'Araç üretimi' },
      { id: 'aftersales', emoji: '🛠️', en: 'After sales and service', tr: 'Satış sonrası ve servis' },
      { id: 'sales', emoji: '🤝', en: 'Sales and dealerships', tr: 'Satış ve bayilik' },
      { id: 'autonomy', emoji: '🛰️', en: 'Driver assistance', tr: 'Sürüş destek sistemleri' },
      { id: 'fleet', emoji: '🚐', en: 'Fleet management', tr: 'Filo yönetimi' },
    ],
    tools: [
      { id: 'obd', emoji: '🔌', en: 'OBD diagnostics', tr: 'OBD diyagnostik' },
      { id: 'can', emoji: '🔗', en: 'CAN bus' },
      { id: 'catia', emoji: '📐', en: 'CATIA' },
      { id: 'iatf', emoji: '📋', en: 'IATF 16949' },
      { id: 'matlab', emoji: '📊', en: 'MATLAB / Simulink' },
      { id: 'autosar', emoji: '⚙️', en: 'AUTOSAR' },
    ],
  },

  telecom: {
    areas: [
      { id: 'mobile', emoji: '📡', en: 'Mobile networks', tr: 'Mobil şebekeler' },
      { id: 'fibre', emoji: '🧵', en: 'Fibre and access', tr: 'Fiber ve erişim' },
      { id: 'core', emoji: '🧠', en: 'Core networks', tr: 'Çekirdek şebeke' },
      { id: 'rf', emoji: '📶', en: 'RF planning', tr: 'RF planlama' },
      { id: 'security', emoji: '🛡️', en: 'Network security', tr: 'Ağ güvenliği' },
      { id: 'operations', emoji: '🖥️', en: 'Network operations', tr: 'Şebeke operasyonu' },
      { id: 'satellite', emoji: '🛰️', en: 'Satellite', tr: 'Uydu' },
      { id: 'regulation', emoji: '📜', en: 'Regulation', tr: 'Düzenleme ve mevzuat' },
    ],
    tools: [
      { id: 'fiveg', emoji: '📶', en: '5G and LTE' },
      { id: 'cisco', emoji: '🔗', en: 'Cisco networking' },
      { id: 'wireshark', emoji: '🦈', en: 'Wireshark' },
      { id: 'otdr', emoji: '💡', en: 'OTDR and fibre testing', tr: 'OTDR ve fiber ölçüm' },
      { id: 'linux', emoji: '🐧', en: 'Linux' },
      { id: 'python', emoji: '🐍', en: 'Python' },
    ],
  },

  property: {
    areas: [
      { id: 'sales', emoji: '🤝', en: 'Sales and letting', tr: 'Satış ve kiralama' },
      { id: 'valuation', emoji: '🧮', en: 'Valuation', tr: 'Değerleme' },
      { id: 'development', emoji: '🏗️', en: 'Development', tr: 'Proje geliştirme' },
      { id: 'facility', emoji: '🧹', en: 'Facility management', tr: 'Tesis yönetimi' },
      { id: 'investment', emoji: '📈', en: 'Property investment', tr: 'Gayrimenkul yatırımı' },
      { id: 'legal', emoji: '📜', en: 'Deeds and law', tr: 'Tapu ve hukuk' },
      { id: 'marketing', emoji: '📣', en: 'Marketing a property', tr: 'Gayrimenkul pazarlama' },
    ],
    tools: [
      { id: 'excel', emoji: '📊', en: 'Excel modelling', tr: 'Excel modelleme' },
      { id: 'crm', emoji: '🤝', en: 'CRM systems', tr: 'CRM sistemleri' },
      { id: 'gis', emoji: '🗺️', en: 'GIS mapping', tr: 'GIS haritalama' },
      { id: 'photo', emoji: '📷', en: 'Property photography', tr: 'Gayrimenkul fotoğrafçılığı' },
      { id: 'valuationstd', emoji: '📋', en: 'Valuation standards', tr: 'Değerleme standartları' },
    ],
  },

  public: {
    areas: [
      { id: 'policy', emoji: '📜', en: 'Policy making', tr: 'Politika yapımı' },
      { id: 'procurement', emoji: '🧾', en: 'Public procurement', tr: 'Kamu ihaleleri' },
      { id: 'municipal', emoji: '🏛️', en: 'Local government', tr: 'Yerel yönetim' },
      { id: 'social', emoji: '🤝', en: 'Social services', tr: 'Sosyal hizmetler' },
      { id: 'digital', emoji: '💻', en: 'Digital government', tr: 'Dijital devlet' },
      { id: 'budget', emoji: '💰', en: 'Public finance', tr: 'Kamu maliyesi' },
      { id: 'emergency', emoji: '🚨', en: 'Emergency management', tr: 'Afet ve acil yönetimi' },
      { id: 'urban', emoji: '🌆', en: 'Urban planning', tr: 'Şehir planlama' },
    ],
    tools: [
      { id: 'procurementlaw', emoji: '📜', en: 'Procurement law', tr: 'İhale mevzuatı' },
      { id: 'gis', emoji: '🗺️', en: 'GIS mapping', tr: 'GIS haritalama' },
      { id: 'excel', emoji: '📊', en: 'Excel' },
      { id: 'projectmgmt', emoji: '🗓️', en: 'Project management', tr: 'Proje yönetimi' },
      { id: 'openoata', emoji: '📈', en: 'Open data and dashboards', tr: 'Açık veri ve gösterge panelleri' },
    ],
  },
};

/* The name in the language on screen, falling back to the English one — which
   is also what gets sent to the model, so a course asked for in Turkish still
   knows it is about cyber security. */
const labelIn = (entry, language) => (language === 'Türkçe' && entry.tr) || entry.en;

const listFor = (kind) => (sector, language) => (FIELDS[sector]?.[kind] || []).map((entry) => ({
  id: entry.id,
  emoji: entry.emoji,
  label: labelIn(entry, language),
  name: entry.en,
}));

export const areasFor = listFor('areas');
export const toolsFor = listFor('tools');

export const hasFields = (sector) => Boolean(FIELDS[sector]);

/* What the course prompt is given: English names, in the order they were
   offered, for whatever was ticked. */
export function namesOf(sector, kind, chosen) {
  const list = FIELDS[sector]?.[kind] || [];
  return list.filter((entry) => chosen.includes(entry.id)).map((entry) => entry.en);
}
