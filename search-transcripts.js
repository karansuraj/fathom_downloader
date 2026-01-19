#!/usr/bin/env node

/**
 * Search exported Fathom transcripts (Markdown files) for a query string.
 *
 * Usage:
 *   node search-transcripts.js "some text"
 *
 * Options:
 *   --dir <path>         Directory containing transcripts (default: ./transcripts)
 *   --context <n>        Lines of context before/after each match (default: 0)
 *   --case-sensitive     Case sensitive search (default: false)
 *   --fuzzy              Fuzzy match across lines, returns best matches (default: false)
 *   --limit <n>          Max fuzzy results to print (default: 20)
 *   --min-score <n>      Minimum fuzzy score to include (default: -1000)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = {
    dir: './transcripts',
    context: 0,
    caseSensitive: false,
    fuzzy: false,
    limit: 20,
    minScore: -1000,
    query: null,
  };

  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      args.dir = argv[i + 1] || args.dir;
      i++;
      continue;
    }
    if (a.startsWith('--dir=')) {
      args.dir = a.slice('--dir='.length) || args.dir;
      continue;
    }
    if (a === '--context') {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n)) args.context = Math.max(0, Math.floor(n));
      i++;
      continue;
    }
    if (a.startsWith('--context=')) {
      const n = Number(a.slice('--context='.length));
      if (!Number.isNaN(n)) args.context = Math.max(0, Math.floor(n));
      continue;
    }
    if (a === '--case-sensitive') {
      args.caseSensitive = true;
      continue;
    }
    if (a === '--fuzzy') {
      args.fuzzy = true;
      continue;
    }
    if (a === '--limit') {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n)) args.limit = Math.max(1, Math.floor(n));
      i++;
      continue;
    }
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isNaN(n)) args.limit = Math.max(1, Math.floor(n));
      continue;
    }
    if (a === '--min-score') {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n)) args.minScore = n;
      i++;
      continue;
    }
    if (a.startsWith('--min-score=')) {
      const n = Number(a.slice('--min-score='.length));
      if (!Number.isNaN(n)) args.minScore = n;
      continue;
    }
    if (a === '--help' || a === '-h') {
      return { ...args, help: true };
    }
    positional.push(a);
  }

  if (positional.length > 0) {
    args.query = positional.join(' ');
  }

  return args;
}

function printHelp() {
  console.log(`
Search exported transcripts for a query.

Usage:
  node search-transcripts.js "query"

Options:
  --dir <path>         Directory containing transcripts (default: ./transcripts)
  --context <n>        Lines of context before/after each match (default: 0)
  --case-sensitive     Case sensitive search (default: false)
  --fuzzy              Fuzzy match across lines, returns best matches (default: false)
  --limit <n>          Max fuzzy results to print (default: 20)
  --min-score <n>      Minimum fuzzy score to include (default: -1000)
  -h, --help           Show help

Examples:
  node search-transcripts.js "pricing"
  node search-transcripts.js "error budget" --context 2
  node search-transcripts.js "Kubernetes" --case-sensitive
  node search-transcripts.js "we should raise prices" --fuzzy
`);
}

async function listMarkdownFilesRecursive(dirPath) {
  const out = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdownFilesRecursive(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function normalizeForSearch(s, caseSensitive) {
  return caseSensitive ? s : s.toLowerCase();
}

async function searchFile(filePath, queryNorm, opts) {
  const matches = [];
  const before = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let pendingAfter = 0;
  let currentBlock = null;

  const flushBlock = () => {
    if (currentBlock && currentBlock.lines.length > 0) {
      matches.push(currentBlock);
    }
    currentBlock = null;
  };

  for await (const line of rl) {
    lineNo++;
    const lineNorm = normalizeForSearch(line, opts.caseSensitive);
    const isHit = queryNorm.length > 0 && lineNorm.includes(queryNorm);

    if (isHit) {
      // Start or extend a block
      if (!currentBlock) {
        currentBlock = {
          startLine: Math.max(1, lineNo - before.length),
          lines: [],
        };
        for (const b of before) currentBlock.lines.push(b);
      }
      currentBlock.lines.push({ lineNo, text: line, hit: true });
      pendingAfter = opts.context;
    } else if (pendingAfter > 0) {
      if (!currentBlock) {
        currentBlock = { startLine: lineNo, lines: [] };
      }
      currentBlock.lines.push({ lineNo, text: line, hit: false });
      pendingAfter--;
      if (pendingAfter === 0) flushBlock();
    } else {
      flushBlock();
    }

    // Maintain rolling "before" buffer for context
    before.push({ lineNo, text: line, hit: false });
    if (before.length > opts.context) before.shift();
  }

  flushBlock();
  return matches;
}

function printMatches(filePath, blocks, baseDir) {
  const rel = baseDir ? path.relative(baseDir, filePath) : filePath;
  for (const block of blocks) {
    console.log(`\n${rel}`);
    for (const l of block.lines) {
      const prefix = l.hit ? '>' : ' ';
      console.log(`${prefix} ${String(l.lineNo).padStart(5, ' ')} | ${l.text}`);
    }
  }
}

function printFuzzyResults(results, baseDir) {
  for (const r of results) {
    const rel = baseDir ? path.relative(baseDir, r.filePath) : r.filePath;
    console.log(`\n${rel} (score: ${r.score})`);
    for (const l of r.contextLines) {
      const prefix = l.hit ? '>' : ' ';
      console.log(`${prefix} ${String(l.lineNo).padStart(5, ' ')} | ${l.text}`);
    }
  }
}

async function fuzzySearchFiles(files, args, baseDir) {
  let fuzzysort;
  try {
    // eslint-disable-next-line global-require
    fuzzysort = require('fuzzysort');
  } catch (e) {
    console.error(
      'Fuzzy search requires the "fuzzysort" dependency. Run: npm install'
    );
    process.exit(1);
  }

  const results = [];
  const maxBuffer = Math.max(args.limit * 20, 200);

  for (const filePath of files) {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim().length === 0) continue;

      const res = fuzzysort.single(args.query, line, {
        ...(args.caseSensitive ? { caseSensitive: true } : {}),
      });
      if (!res) continue;
      if (res.score < args.minScore) continue;

      const highlighted = fuzzysort.highlight(res, '[', ']') || line;

      const start = Math.max(0, i - args.context);
      const end = Math.min(lines.length - 1, i + args.context);
      const contextLines = [];
      for (let j = start; j <= end; j++) {
        contextLines.push({
          lineNo: j + 1,
          text: j === i ? highlighted : lines[j],
          hit: j === i,
        });
      }

      results.push({
        score: res.score,
        filePath,
        lineNo: i + 1,
        contextLines,
      });

      if (results.length > maxBuffer) {
        results.sort((a, b) => b.score - a.score);
        results.length = args.limit;
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, args.limit);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.query || args.query.trim().length === 0) {
    console.error('Error: missing query. Try: node search-transcripts.js "query"');
    process.exit(1);
  }

  const dirAbs = path.resolve(args.dir);
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    console.error(`Error: transcripts directory not found: ${dirAbs}`);
    process.exit(1);
  }

  const files = await listMarkdownFilesRecursive(dirAbs);
  if (files.length === 0) {
    console.log(`No .md files found under: ${dirAbs}`);
    return;
  }

  if (args.fuzzy) {
    const results = await fuzzySearchFiles(files, args, dirAbs);
    printFuzzyResults(results, dirAbs);
    console.log(`\nDone. Showing top ${results.length} matches across ${files.length} files.`);
  } else {
    const queryNorm = normalizeForSearch(args.query, args.caseSensitive);

    let fileHitCount = 0;
    for (const f of files) {
      const blocks = await searchFile(f, queryNorm, args);
      if (blocks.length > 0) {
        fileHitCount++;
        printMatches(f, blocks, dirAbs);
      }
    }

    console.log(`\nDone. Matched in ${fileHitCount}/${files.length} files.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

