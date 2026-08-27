/* The tools Vlipa reaches for while working on a project in Vlipa Studio.

   The shape is the one a coding agent uses — list, read, write, edit — rather
   than "here is the whole file again in a chat message". It matters for two
   reasons. A model that has to re-emit three hundred lines to change one of
   them will get some of the other two hundred and ninety-nine wrong. And a
   model that can read a file before changing it stops guessing at what is
   already there.

   The project does not live on this server: it lives in the browser, and
   arrives with the request. These tools work on that copy, and what changed
   goes back in the answer for the browser to apply. */

const MAX_FILES = 60;
const MAX_TEXT = 60000;      // per file, in and out
const MAX_TOTAL = 200000;    // the whole project

export const codeToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lists every file in the project, with its size. Use it first when you do not know what is there.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Returns the whole contents of one file. Read a file before you change it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The file, as it is listed' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Writes a file, replacing whatever was there, and creates it if it does not exist. ' +
        'Use it for a new file or a rewrite. To change part of an existing file, use edit_file instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where it goes: index.html, src/app.js' },
          content: { type: 'string', description: 'The complete contents of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Changes part of a file: each edit replaces one exact piece of text with another. ' +
        'old_text must appear exactly once in the file. This is the way to make a small change ' +
        'to a big file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file to change' },
          edits: {
            type: 'array',
            description: 'The replacements, each matched against the file as it is now.',
            items: {
              type: 'object',
              properties: {
                old_text: { type: 'string', description: 'Exact text to find. Must be unique in the file.' },
                new_text: { type: 'string', description: 'What to put in its place.' },
              },
              required: ['old_text', 'new_text'],
            },
          },
        },
        required: ['path', 'edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Removes a file from the project. Only when it should genuinely not be there any more.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
];

function tidyPath(path) {
  return String(path || '')
    .trim()
    .replace(/^[./]+/, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .slice(0, 200);
}

/* A tool set bound to one project. Nothing here touches a disk: `files` is the
   browser's copy, and `changed` is what has to go back to it. */
export function projectTools(incoming) {
  const files = new Map();
  let total = 0;

  for (const file of Array.isArray(incoming) ? incoming.slice(0, MAX_FILES) : []) {
    const path = tidyPath(file?.path);
    if (!path) continue;

    const text = String(file?.text ?? '').slice(0, MAX_TEXT);
    if (total + text.length > MAX_TOTAL) break;

    total += text.length;
    files.set(path, text);
  }

  const changed = new Map();      // path → text, or null where it was deleted

  const put = (path, text) => {
    files.set(path, text);
    changed.set(path, text);
  };

  async function run(name, args = {}) {
    const path = tidyPath(args.path);

    if (name === 'list_files') {
      if (!files.size) return 'The project is empty. Nothing has been written yet.';

      return [...files.entries()]
        .map(([at, text]) => `${at} — ${text.split('\n').length} lines, ${text.length} characters`)
        .join('\n');
    }

    if (name === 'read_file') {
      if (!path) return 'No path was given.';
      if (!files.has(path)) return `There is no file called "${path}". Use list_files to see what is there.`;

      return files.get(path) || '(this file is empty)';
    }

    if (name === 'write_file') {
      if (!path) return 'No path was given.';

      const text = String(args.content ?? '');
      if (text.length > MAX_TEXT) return `That file is too big to write (over ${MAX_TEXT} characters).`;
      if (!files.has(path) && files.size >= MAX_FILES) return `A project holds at most ${MAX_FILES} files.`;

      const was = files.has(path);
      put(path, text);

      return `${was ? 'Rewrote' : 'Created'} ${path} — ${text.split('\n').length} lines.`;
    }

    if (name === 'edit_file') {
      if (!path) return 'No path was given.';
      if (!files.has(path)) return `There is no file called "${path}". Write it first, or check list_files.`;

      const edits = Array.isArray(args.edits) ? args.edits.slice(0, 20) : [];
      if (!edits.length) return 'No edits were given.';

      let text = files.get(path);
      const done = [];

      // Every edit is matched against the file as it was, so a model that
      // sends two edits does not have to imagine the state between them.
      for (const edit of edits) {
        const oldText = String(edit?.old_text ?? '');
        const newText = String(edit?.new_text ?? '');

        if (!oldText) return 'An edit had no old_text. Nothing was changed.';

        const first = text.indexOf(oldText);
        if (first === -1) {
          return `Could not find that text in ${path}, so nothing was changed. Read the file again and match it exactly.`;
        }

        if (text.indexOf(oldText, first + 1) !== -1) {
          return `That text appears more than once in ${path}, so it is not clear which one to change. Include more of the surrounding lines.`;
        }

        text = text.slice(0, first) + newText + text.slice(first + oldText.length);
        done.push(oldText.split('\n')[0].trim().slice(0, 40));
      }

      if (text.length > MAX_TEXT) return `That would make ${path} too big.`;

      put(path, text);
      return `Edited ${path}: ${done.length} change${done.length === 1 ? '' : 's'}. It is now ${text.split('\n').length} lines.`;
    }

    if (name === 'delete_file') {
      if (!files.has(path)) return `There is no file called "${path}".`;

      files.delete(path);
      changed.set(path, null);
      return `Deleted ${path}.`;
    }

    return `No such tool: ${name}.`;
  }

  return {
    definitions: codeToolDefinitions,
    run,
    /* What the browser has to do to its own copy to match. */
    changes: () => [...changed.entries()].map(([path, text]) => ({ path, text, removed: text === null })),
    listing: () => [...files.keys()],
  };
}
