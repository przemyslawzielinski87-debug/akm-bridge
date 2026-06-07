interface SecretMatch {
  category: string
  safe_location: string
}

const SECRET_PATTERNS: { regex: RegExp; category: string }[] = [
  { regex: /ghp_[A-Za-z0-9_]{36,}/g, category: 'GitHub personal access token (ghp_)' },
  { regex: /gho_[A-Za-z0-9_]{36,}/g, category: 'GitHub OAuth access token (gho_)' },
  { regex: /ghu_[A-Za-z0-9_]{36,}/g, category: 'GitHub user-to-server token (ghu_)' },
  { regex: /ghs_[A-Za-z0-9_]{36,}/g, category: 'GitHub server-to-server token (ghs_)' },
  { regex: /ghr_[A-Za-z0-9_]{36,}/g, category: 'GitHub refresh token (ghr_)' },
  { regex: /sk-[A-Za-z0-9_\-]{20,}/g, category: 'OpenAI API key (sk-)' },
  { regex: /nvapi-[A-Za-z0-9_\-]{20,}/g, category: 'NVIDIA API key (nvapi-)' },
  { regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, category: 'Private key (PEM)' },
  { regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]?\S+/gi, category: 'Password assignment' },
  { regex: /(?:token)\s*[:=]\s*['"]?\S{20,}/gi, category: 'Token assignment' },
  { regex: /(?:secret)\s*[:=]\s*['"]?\S{20,}/gi, category: 'Secret assignment' },
]

export function detectSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  const seen = new Set<string>()
  for (const { regex, category } of SECRET_PATTERNS) {
    regex.lastIndex = 0
    const match = regex.exec(text)
    if (match && !seen.has(category)) {
      seen.add(category)
      const idx = match.index
      const lineStart = text.lastIndexOf('\n', idx) + 1
      const lineNum = text.slice(0, idx).split('\n').length
      matches.push({
        category,
        safe_location: `line ${lineNum}, column ${idx - lineStart + 1}`,
      })
    }
  }
  return matches
}

export function hasSecrets(text: string): boolean {
  return detectSecrets(text).length > 0
}
