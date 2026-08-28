/* The studio's own menu: the pages down the left, in the order they appear.

   It lives on its own because Vlipy draws the same rail — somebody learning
   inside the workspace should see the workspace, not a second menu with
   different words in it — and two copies of a menu drift apart within a
   week. */

export const PAGES = [
  { id: 'panel',    label: 'Panel',       icon: 'M4 13h7V4H4zM13 20h7v-9h-7zM4 20h7v-5H4zM13 9h7V4h-7z' },

  // Vlipa is three tools rather than one, so the menu folds them under it.
  {
    id: 'chat',
    label: 'Vlipa',
    icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z',
    // Pressing it opens Vlipa; the fold underneath is on top of that, not
    // instead of it, the same way Tasks behaves.
    opens: true,
    children: [
      { id: 'chat',  label: 'Vlipa',        hint: 'Ask anything',                icon: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z' },
      { id: 'code',  label: 'Vlipa Studio', hint: 'Build it, publish it',        icon: 'M9 8l-4 4 4 4M15 8l4 4-4 4' },
      { id: 'write', label: 'Vlipa Write',  hint: 'Documents and reports',       icon: 'M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20zM14 3.5V8h4M9 12h6M9 16h4' },
    ],
  },

  // Vlipy is not a page of the studio, it is the learning app next door — so
  // this one leaves rather than routes. The icon is Vlipy's own head.
  {
    id: 'vlipy',
    label: 'Vlipy',
    away: '/vlipy',
    children: [
      { id: 'vlipy', label: 'Vlipy', hint: 'Learn the job', away: '/vlipy', icon: 'M4 6.5c3-1.6 5.6-1.6 8 0 2.4-1.6 5-1.6 8 0v11c-3-1.6-5.6-1.6-8 0-2.4-1.6-5-1.6-8 0zM12 6.5v11' },
      {
        id: 'course',
        label: 'Create course',
        hint: 'Teach your own people',
        away: '/vlipy#course',
        boss: true,
        icon: 'M12 5v14M5 12h14',
      },
    ],
    icon: 'M5.9 12.2a6.1 6.1 0 0 1 12.2 0v2.1a3.7 3.7 0 0 1-3.7 3.7h-4.8a3.7 3.7 0 0 1-3.7-3.7z'
      + ' M5.9 12c-1.9 0-1.9 4.7 0 4.7 M18.1 12c1.9 0 1.9 4.7 0 4.7'
      + ' M13 6.6c1.8-2.6 3.9-3.6 4.3-3 .5.6-.4 2.8-2 4.1'
      + ' M11.2 13.1a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0',
  },

  // Groups folds open the same way, but its children are the company's own
  // groups rather than a fixed list.
  { id: 'groups',   label: 'Groups',     icon: 'M7 8h10M7 12h6M4.5 4.5h15v11h-9l-4 3.5v-3.5h-2z', dynamic: true },
  // Tasks folds too, but only for whoever hands the work out: the board is
  // everybody's, the distribution is theirs.
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'M5 6h14M5 12h14M5 18h9',
    // The board is what Tasks means, so pressing it still goes there; the
    // fold opening underneath is on top of that, not instead of it.
    opens: true,
    children: [
      { id: 'tasks', label: 'Tasks', hint: 'The board', icon: 'M5 6h14M5 12h14M5 18h9' },
      {
        id: 'workload',
        label: 'Distribution',
        hint: 'Who is carrying what',
        boss: true,
        icon: 'M4 19.5V14M9.3 19.5V8M14.7 19.5v-6M20 19.5V5',
      },
    ],
  },
  {
    id: 'departments',
    label: 'Departments',
    icon: 'M4 20V7l7-3v16M11 20h9V11h-9M14.5 14.5h2M14.5 17.5h2M7 10h1M7 13h1M7 16h1',
  },
  { id: 'tables',   label: 'Tables',    icon: 'M4 5h16v14H4zM4 10h16M10 10v9' },
  { id: 'meetings', label: 'Meetings', icon: 'M4 7h11v10H4zM15 11l5-3v8l-5-3z' },
  // Team folds for whoever runs the company: everybody sees the people, only
  // they see the panel where roles are handed out.
  {
    id: 'team',
    label: 'Team',
    icon: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5M17 14c2.3.4 4 2.2 4 5',
    opens: true,
    children: [
      { id: 'team', label: 'Team', hint: 'Who is here', icon: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5M17 14c2.3.4 4 2.2 4 5' },
      {
        id: 'members',
        label: 'Members',
        hint: 'Roles and invitations',
        boss: 'member.manage',
        icon: 'M12 12.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6M17.5 4.5l1.4 1.4 2.6-2.6',
      },
      {
        id: 'pace',
        label: 'How it is going',
        hint: 'What everybody finished',
        boss: 'task.manage',
        icon: 'M4 19h16M6.5 19V9.5M11 19V5M15.5 19v-7M20 19v-4',
      },
    ],
  },
  { id: 'settings', label: 'Settings',     icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.2-2-3.4-2.2 1a7.6 7.6 0 0 0-2.6-1.5L14.2 3H9.8l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.2-1-2 3.4 2 1.2a7.6 7.6 0 0 0 0 3l-2 1.2 2 3.4 2.2-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4.4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.2 1 2-3.4z' },
];
