/* Tool calling: the functions Vlipa can reach for.

   To add a capability: describe it in `toolDefinitions`, then handle it in
   `executeTool`. The model sees only the description and decides when to ask. */

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Returns the current date and time (Istanbul time). Use it when the user asks for the time or the date.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vlipa_info',
      description:
        'Returns facts about the vlipa software studio (services, how a project runs, principles, stack). ' +
        'Use it when the user asks what vlipa does, how it works, or what it builds with.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['services', 'process', 'principles', 'stack'],
            description: 'Which topic is being asked about',
          },
        },
        required: ['topic'],
      },
    },
  },
];

const VLIPA_INFO = {
  services:
    'vlipa works in six areas: custom software (web, mobile, internal tools, APIs), automation and AI, ' +
    'UI/UX design, e-commerce (storefront, stock, payments, ERP integration), infrastructure (cloud, CI/CD, ' +
    'monitoring, backups) and data (warehouse, dashboards, reporting).',
  process:
    'A project runs in four stages. Discovery: we watch the process where it happens and write down where ' +
    'it jams. Scope: scope, timeline and price are settled in writing before any work starts. ' +
    'Build: two-week rounds, each ending in something you can click. ' +
    'Launch & Care: migration, training, handover and the maintenance after it.',
  principles:
    'Four principles: a clear scope before any estimate; working software every two weeks; source code, ' +
    'servers and accounts in the client\'s name from day one; maintenance after launch treated as part of ' +
    'the job.',
  stack:
    'Product side: TypeScript, React, Next.js, React Native, Flutter. Services: Node.js, Python, .NET, Laravel, ' +
    'REST and GraphQL. Data: PostgreSQL, MSSQL, Redis, ClickHouse, Metabase. Platform: Docker, AWS, Azure, ' +
    'GitHub Actions, Grafana.',
};

export async function executeTool(name, args = {}) {
  switch (name) {
    case 'get_current_time':
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'Europe/Istanbul',
      }).format(new Date());

    case 'get_vlipa_info':
      return VLIPA_INFO[String(args.topic || 'services')] || VLIPA_INFO.services;

    default:
      return `Unknown tool: ${name}`;
  }
}
