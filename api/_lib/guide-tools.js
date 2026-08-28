/* Showing somebody where a thing is, rather than describing it.

   "Where do we hand out tasks?" has a page as its answer, and reading a
   sentence about the left-hand menu is a worse answer than being taken
   there. So the assistant, inside the studio, is given one function: it can
   propose a page. Nothing moves on its own — the proposal comes back with
   the reply and the browser offers it, so the reader is the one who decides
   whether the page changes under them. */

const PAGES = [
  { id: 'panel', label: 'Panel', about: 'the dashboard: counts, your open work, the charts of how work is spread' },
  { id: 'chat', label: 'Vlipa', about: 'this conversation' },
  { id: 'code', label: 'Vlipa Studio', about: 'building a site or app and publishing it' },
  { id: 'write', label: 'Vlipa Write', about: 'writing documents and reports' },
  { id: 'groups', label: 'Groups', about: 'the company chat channels' },
  { id: 'tasks', label: 'Tasks', about: 'the task board: opening a task, assigning it, moving it along' },
  { id: 'workload', label: 'Distribution', about: 'who is carrying what, the departments, and sharing work out with Vlipa (admins only)' },
  { id: 'tables', label: 'Tables', about: 'spreadsheets: lists, stock, prices, anything tabular' },
  { id: 'meetings', label: 'Meetings', about: 'video rooms' },
  { id: 'team', label: 'Team', about: 'the people, their roles and their departments; invite codes' },
  { id: 'settings', label: 'Settings', about: 'the company name, departments and everything about the account' },
];

export const PAGE_LIST = PAGES.map((page) => `${page.id} — ${page.label}: ${page.about}`).join('\n');

/* One function, and a note of what it was asked for. */
export function guideTools() {
  let wanted = null;

  const definitions = [{
    type: 'function',
    function: {
      name: 'open_page',
      description:
        'Offer to take the reader to a page of the studio. Call this whenever the answer to what they asked '
        + 'is somewhere in the studio — where to create a task, where the tables are, where to invite somebody. '
        + 'It does not move them: it puts a button under your reply, and they choose. '
        + 'Call it once, then say in one short sentence that you are taking them there and what they will do when '
        + 'they arrive.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: PAGES.map((page) => page.id),
            description: 'Which page',
          },
          why: {
            type: 'string',
            description: 'One short line, in the reader\'s language, saying what they can do there.',
          },
        },
        required: ['page'],
      },
    },
  }];

  async function run(name, args) {
    if (name !== 'open_page') return `There is no tool called ${name}.`;

    const page = PAGES.find((one) => one.id === args?.page);
    if (!page) return 'That is not one of the pages. Pick one from the list.';

    wanted = {
      page: page.id,
      label: page.label,
      why: String(args?.why || '').slice(0, 160),
    };

    return `Offered: ${page.label}. A button is now under your reply. Say one short sentence and stop.`;
  }

  return { definitions, run, route: () => wanted };
}
