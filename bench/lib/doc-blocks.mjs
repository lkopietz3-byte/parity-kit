// Runs the ```js blocks of a markdown page and pairs each with the ```text block under it.
// Used by test/what-a-diff-cannot-answer.test.ts (check) and bench/doc-cases.mjs (rewrite).

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const PAIR = /```js\n([\s\S]*?)```\n\n```text\n([\s\S]*?)```/g;

/** Every js block that is followed by a text block, with the heading above it. */
export function findCases(markdown) {
  const cases = [];
  for (const m of markdown.matchAll(PAIR)) {
    const before = markdown.slice(0, m.index);
    const headings = [...before.matchAll(/^## (.+)$/gm)];
    cases.push({
      title: headings.length > 0 ? headings[headings.length - 1][1] : '',
      code: m[1],
      expected: m[2],
      textStart: m.index + m[0].length - m[2].length - 3,
      textEnd: m.index + m[0].length - 3,
    });
  }
  return cases;
}

/** Runs a block with `import` lines served from `modules` and returns what it printed. */
export async function runCode(code, modules) {
  const prelude = [];
  const body = code.replace(/^import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+'([^']+)';?[ \t]*$/gm, (_all, def, names, spec) => {
    if (!(spec in modules)) throw new Error(`the page imports "${spec}", which the harness does not provide`);
    prelude.push(def !== undefined ? `const ${def} = __modules[${JSON.stringify(spec)}].default;` : `const {${names}} = __modules[${JSON.stringify(spec)}];`);
    return '';
  });
  const lines = [];
  const capture = { log: (...args) => lines.push(args.map((a) => String(a)).join(' ')) };
  await new AsyncFunction('__modules', 'console', `${prelude.join('\n')}\n${body}`)(modules, capture);
  return lines.join('\n');
}

/** The markdown with every text block replaced by what its code prints. */
export async function rewrite(markdown, modules) {
  const cases = findCases(markdown);
  let out = markdown;
  for (const c of [...cases].reverse()) {
    const printed = await runCode(c.code, modules);
    out = `${out.slice(0, c.textStart)}${printed}\n${out.slice(c.textEnd)}`;
  }
  return out;
}
