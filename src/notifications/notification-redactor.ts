const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "github_pat", regex: /ghp_[A-Za-z0-9]{20,}/g },
  { name: "github_fine_grained", regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "openai_key", regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: "anthropic_key", regex: /sk-ant-[A-Za-z0-9\-]{20,}/g },
  { name: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "bearer_token", regex: /Bearer\s+[A-Za-z0-9_\-\.=]{20,}/gi },
  { name: "private_key_block", regex: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (RSA |OPENSSH |EC )?PRIVATE KEY-----/g },
  { name: "slack_token", regex: /xox[baprs]-[A-Za-z0-9\-]{10,}/g },
  { name: "telegram_token", regex: /\b\d{8,12}:[A-Za-z0-9_\-]{35}\b/g },
  { name: "basic_auth", regex: /\b[a-zA-Z0-9._%+-]+:[a-zA-Z0-9._%+-]{6,}@[a-zA-Z0-9.-]+\b/g },
  { name: "smtp_header_injection", regex: /(\r|\n|%0a|%0d)(bcc|cc|to|from|subject):/gi },
];

export interface RedactionResult {
  text: string;
  redacted_count: number;
  redactions: Array<{ pattern: string; index: number; length: number }>;
}

export function redactSecrets(input: string): RedactionResult {
  if (!input) return { text: "", redacted_count: 0, redactions: [] };
  let text = input;
  let count = 0;
  const redactions: RedactionResult["redactions"] = [];

  for (const { name, regex } of SECRET_PATTERNS) {
    const matches = [...text.matchAll(regex)];
    for (const m of matches) {
      const index = m.index ?? 0;
      const length = m[0].length;
      count++;
      redactions.push({ pattern: name, index, length });
    }
    text = text.replace(regex, `[REDACTED:${name}]`);
  }
  return { text, redacted_count: count, redactions };
}

export function sanitizeSubject(subject: string): string {
  return redactSecrets(subject).text.replace(/[\r\n]/g, " ").substring(0, 200);
}

export function sanitizeBody(body: string, maxLen = 5000): string {
  const redacted = redactSecrets(body);
  let text = redacted.text;
  if (text.length > maxLen) text = text.substring(0, maxLen) + "\n[...truncated]";
  return text;
}

export function isSafeForUrl(value: string): boolean {
  if (!value) return false;
  if (/javascript:/i.test(value)) return false;
  if (value.includes("..")) return false;
  return /^[A-Za-z0-9_\-\.\/=:?&]{1,512}$/.test(value);
}

export function buildDeepLink(baseUrl: string, path: string, params: Record<string, string> = {}): string | null {
  if (!baseUrl) return null;
  if (!isSafeForUrl(path)) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const cleanParams: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (!isSafeForUrl(v)) continue;
    cleanParams.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  const qs = cleanParams.length > 0 ? `?${cleanParams.join("&")}` : "";
  return `${url.origin}${path}${qs}`;
}
