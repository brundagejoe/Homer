const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/

export interface ParsedPrUrl {
  owner: string
  repo: string
  number: number
}

export function parsePrUrl(input: string): ParsedPrUrl | null {
  const match = input.trim().match(PR_URL_RE)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}
