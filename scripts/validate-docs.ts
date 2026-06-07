import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs");
const EXAMPLES = join(DOCS, "examples");

let errors = 0;
let warnings = 0;

function error(msg: string) {
  console.error(`  ERROR: ${msg}`);
  errors++;
}

function warn(msg: string) {
  console.warn(`  WARN: ${msg}`);
  warnings++;
}

function checkFile(path: string): boolean {
  if (!existsSync(path)) {
    error(`File not found: ${path}`);
    return false;
  }
  return true;
}

function validateJSON(path: string) {
  if (!checkFile(path)) return;
  try {
    JSON.parse(readFileSync(path, "utf-8"));
  } catch (e: any) {
    error(`Invalid JSON in ${path}: ${e.message}`);
  }
}

function validateYAMLFrontmatter(path: string) {
  if (!checkFile(path)) return;
  const content = readFileSync(path, "utf-8");
  if (!content.startsWith("---")) {
    warn(`No YAML frontmatter in ${path}`);
    return;
  }
  const end = content.indexOf("---", 3);
  if (end === -1) {
    error(`Unterminated YAML frontmatter in ${path}`);
  }
}

function scanSecrets(path: string) {
  if (!checkFile(path)) return;
  const content = readFileSync(path, "utf-8");
  const secretPatterns = [
    /ghp_[a-zA-Z0-9]{36}/,
    /github_pat_[a-zA-Z0-9]{22,}/,
    /nvapi-[a-zA-Z0-9_-]{20,}/,
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  for (const pattern of secretPatterns) {
    const match = content.match(pattern);
    if (match) {
      error(`Potential secret in ${path}: ${match[0].slice(0, 12)}...`);
    }
  }
}

function checkNoPrivatePaths(path: string) {
  if (!checkFile(path)) return;
  const content = readFileSync(path, "utf-8");
  const privatePatterns = [
    /\/root\//,
    /\/home\/[^\/]+\/(?!placeholder)/,
    /C:\\Users\//,
  ];
  for (const pattern of privatePatterns) {
    const match = content.match(pattern);
    if (match && !content.includes("placeholder")) {
      warn(`Possible private path in ${path}: ${match[0]}`);
    }
  }
}

console.log("Validating docs and templates...\n");

// Check docs directory
if (!existsSync(DOCS)) {
  error(`Docs directory not found: ${DOCS}`);
  process.exit(1);
}

const requiredDocs = [
  "OPENCODE-CUSTOM-COMMANDS.md",
  "OPENCODE-SPECIALIZED-AGENTS.md",
  "OPENCODE-PERMISSIONS-HARDENING.md",
  "OPENCODE-AGENT-SKILLS.md",
  "OPENCODE-CONTEXT-TOKEN-OPTIMIZATION.md",
  "GITHUB-CI-QUALITY-GATES.md",
];

console.log("Required documentation:");
for (const doc of requiredDocs) {
  const p = join(DOCS, doc);
  if (checkFile(p)) {
    const size = statSync(p).size;
    console.log(`  OK  ${doc} (${size} bytes)`);
    scanSecrets(p);
    checkNoPrivatePaths(p);
  }
}

// Check examples directory
if (existsSync(EXAMPLES)) {
  console.log("\nExample templates:");
  const examples = readdirSync(EXAMPLES, { recursive: true }).filter(
    (f) => typeof f === "string" && f.endsWith(".json")
  ) as string[];
  for (const ex of examples) {
    const p = join(EXAMPLES, ex);
    console.log(`  ${ex}`);
    validateJSON(p);
    scanSecrets(p);
    checkNoPrivatePaths(p);
  }

  // Check skills examples
  const skillsDir = join(EXAMPLES, "skills");
  if (existsSync(skillsDir)) {
    console.log("\nSkill templates:");
    const skills = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
    for (const s of skills) {
      const p = join(skillsDir, s);
      console.log(`  ${s}`);
      validateYAMLFrontmatter(p);
      scanSecrets(p);
    }
  }

  // Check agent examples
  const agentsDir = join(EXAMPLES, "agents");
  if (existsSync(agentsDir)) {
    console.log("\nAgent templates:");
    const agents = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    for (const a of agents) {
      const p = join(agentsDir, a);
      console.log(`  ${a}`);
      validateYAMLFrontmatter(p);
      scanSecrets(p);
    }
  }
}

console.log(`\nResults: ${errors} errors, ${warnings} warnings`);
process.exit(errors > 0 ? 1 : 0);
