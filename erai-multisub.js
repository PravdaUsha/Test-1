// Subs ES — extensión de fuentes torrent para Hayase (v1.1.0).
// Busca en Nyaa solo en fuentes que suelen traer subtítulos en español:
//   1) Erai-raws      -> releases [MultiSub]
//   2) ToonsHub       -> releases (Multi-Subs)
//   3) VARYG          -> releases (Multi-Subs)
//   4) Nyaa "Anime - Non-English-translated" filtrado por palabras de español
// Ojo: "MultiSub" no garantiza español en todos los episodios; la pista de
// subtítulos se elige desde el reproductor de Hayase.

const TRACKERS = [
  'http://nyaa.tracker.wf:7777/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce'
]

const DEFAULTS = {
  domain: 'https://nyaa.si',
  user: 'Erai-raws',
  multiSubOnly: true,
  erai: true,
  toonshub: true,
  varyg: true,
  spanishFansubs: true
}

// ---------- utilidades ----------

const decodeXml = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decodeXml(m[1]).trim() : ''
}

const parseSize = (str = '') => {
  const m = str.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|B)/i)
  if (!m) return 0
  const mult = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }
  return Math.round(parseFloat(m[1]) * (mult[m[2].toLowerCase()] || 1))
}

const buildMagnet = (hash, title) =>
  `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}` +
  TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('')

const clean = (s = '') =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pad = n => String(n).padStart(2, '0')

function parseRss (xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []
  const out = []
  for (const item of items) {
    const title = tag(item, 'title')
    const hash = tag(item, 'nyaa:infoHash').toLowerCase()
    if (!title || !hash) continue
    out.push({
      title,
      link: buildMagnet(hash, title),
      hash,
      size: parseSize(tag(item, 'nyaa:size')),
      seeders: Number(tag(item, 'nyaa:seeders')) || 0,
      leechers: Number(tag(item, 'nyaa:leechers')) || 0,
      downloads: Number(tag(item, 'nyaa:downloads')) || 0,
      accuracy: 'medium',
      date: new Date(tag(item, 'pubDate') || Date.now())
    })
  }
  return out
}

// ---------- reglas por fuente ----------

const MULTISUB = /multi.?subs?/i
const SPANISH = /(spanish|espa[nñ]ol|castellano|latino|\[spa\]|\(spa\)|es-?419|\bspa\b)/i
const DUB_ONLY = /\b(dub|dubbed|doblaje|doblado)\b/i
const EP_SXXEYY = /\bS\d{1,2}E\d+/i
const RANGE = /\d+\s*[-~]\s*\d+/

const epRegexes = {
  // "[Erai-raws] Título - 05 [1080p ...]"
  erai: n => new RegExp(`\\s-\\s0*${n}(v\\d)?\\s*\\[`),
  // "Título S02E05 ..."
  sxxeyy: n => new RegExp(`\\bS\\d{1,2}E0*${n}(?!\\d)`, 'i'),
  // Fansubs variados
  generic: n =>
    new RegExp(
      `(\\s-\\s0*${n}(?!\\d))|(\\bE0*${n}(?!\\d))|(\\[0*${n}(v\\d)?\\])|(#0*${n}(?!\\d))|(\\b(cap(itulo)?|ep(isodio)?)\\.?\\s*0*${n}(?!\\d))`,
      'i'
    )
}

const SOURCES = [
  {
    id: 'erai',
    label: 'Erai-raws',
    useUser: true, // filtro por usuario de Nyaa (opción "user")
    cat: '0_0',
    queryEpisode: true,
    titlesLimit: 3,
    keep: (t, cfg) => t.toLowerCase().startsWith(`[${cfg.user.toLowerCase()}]`) && (!cfg.multiSubOnly || MULTISUB.test(t)),
    epRe: epRegexes.erai,
    isSingle: t => /\s-\s\d{1,4}(v\d)?\s*\[/.test(t)
  },
  {
    id: 'toonshub',
    label: 'ToonsHub',
    term: 'ToonsHub',
    cat: '0_0',
    titlesLimit: 2,
    keep: (t, cfg) => /^\[ToonsHub\]/i.test(t) && (!cfg.multiSubOnly || MULTISUB.test(t)),
    epRe: epRegexes.sxxeyy,
    isSingle: t => EP_SXXEYY.test(t)
  },
  {
    id: 'varyg',
    label: 'VARYG',
    term: 'VARYG',
    cat: '0_0',
    titlesLimit: 2,
    keep: (t, cfg) => /varyg/i.test(t) && (!cfg.multiSubOnly || MULTISUB.test(t)),
    epRe: epRegexes.sxxeyy,
    isSingle: t => EP_SXXEYY.test(t)
  },
  {
    id: 'spanishFansubs',
    label: 'Nyaa (traducidos, español)',
    terms: ['Spanish', 'Español', 'Castellano', 'Latino'],
    cat: '1_3', // Anime - Non-English-translated
    titlesLimit: 2,
    keep: t => SPANISH.test(t) && !(DUB_ONLY.test(t) && !/sub/i.test(t)),
    epRe: epRegexes.generic,
    isSingle: t => !RANGE.test(t) && !/(batch|complet[oa]?|\bBD\b|\bBDRip\b)/i.test(t)
  }
]

// ---------- extensión ----------

export default new (class SubsES {
  cfg (options = {}) {
    const pick = k => options[k] ?? DEFAULTS[k]
    return {
      domain: String(pick('domain')).replace(/\/+$/, ''),
      user: pick('user'),
      multiSubOnly: pick('multiSubOnly'),
      erai: pick('erai'),
      toonshub: pick('toonshub'),
      varyg: pick('varyg'),
      spanishFansubs: pick('spanishFansubs')
    }
  }

  async fetchRss (query, cfg, source, q) {
    const doFetch = query?.fetch || fetch
    const enc = encodeURIComponent(q)
    const urls = source.useUser
      ? [
          `${cfg.domain}/?page=rss&c=${source.cat}&f=0&u=${encodeURIComponent(cfg.user)}&q=${enc}`,
          `${cfg.domain}/user/${encodeURIComponent(cfg.user)}?page=rss&c=${source.cat}&f=0&q=${enc}`,
          `${cfg.domain}/?page=rss&c=${source.cat}&f=0&q=${enc}%20${encodeURIComponent(cfg.user)}`
        ]
      : [`${cfg.domain}/?page=rss&c=${source.cat}&f=0&q=${enc}`]

    for (const url of urls) {
      try {
        const res = await doFetch(url)
        if (!res.ok) continue
        const text = await res.text()
        if (!/<rss|<item/i.test(text)) continue
        const results = parseRss(text).filter(r => source.keep(r.title, cfg))
        if (results.length) return results
      } catch (e) {
        // probar la siguiente URL
      }
    }
    return []
  }

  baseTitles (titles = []) {
    const seen = new Set()
    const out = []
    for (const t of titles) {
      const c = clean(t)
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase())
        out.push(c)
      }
    }
    return out
  }

  queriesFor (source, titles, episode) {
    const base = titles.slice(0, source.titlesLimit)
    const ep = source.queryEpisode && episode ? ` ${pad(episode)}` : ''
    const mk = t => {
      if (source.terms) {
        // primera título con todas las palabras; los demás solo con la primera
        const list = t === base[0] ? source.terms : source.terms.slice(0, 1)
        return list.map(k => `${t} ${k}`)
      }
      if (source.term) return [`${t} ${source.term}`]
      return [t + ep]
    }
    const full = base.flatMap(mk)
    // Respaldo: primeras 2-3 palabras (Erai-raws abrevia títulos).
    const short = source.queryEpisode
      ? [...new Set(base.map(t => t.split(' ').slice(0, 3).join(' ')))]
          .filter(t => t && !base.includes(t))
          .map(t => t + ep)
      : []
    return { full, short }
  }

  async run (query, options, { episode, kind }) {
    const cfg = this.cfg(options)
    if (!query?.titles?.length) return []
    const titles = this.baseTitles(query.titles)
    if (!titles.length) return []

    const active = SOURCES.filter(s => cfg[s.id])
    const perSource = await Promise.all(
      active.map(async source => {
        const { full, short } = this.queriesFor(source, titles, episode)
        const gather = async qs => {
          const settled = await Promise.allSettled(qs.map(q => this.fetchRss(query, cfg, source, q)))
          return settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
        }
        let results = await gather(full)
        if (!results.length && short.length) results = await gather(short)

        if (kind === 'single' && episode) {
          const re = source.epRe(Number(episode))
          results = results.filter(r => re.test(r.title))
        } else if (kind === 'batch') {
          results = results.filter(r => !source.isSingle(r.title))
        }
        return results
      })
    )

    // Unir y quitar duplicados por hash
    const byHash = new Map()
    for (const r of perSource.flat()) if (!byHash.has(r.hash)) byHash.set(r.hash, r)
    let results = [...byHash.values()]

    if (query.exclusions?.length) {
      const ex = query.exclusions.map(e => String(e).toLowerCase()).filter(Boolean)
      results = results.filter(r => !ex.some(e => r.title.toLowerCase().includes(e)))
    }

    // Preferir la resolución pedida, sin dejar la lista vacía por eso.
    if (query.resolution) {
      const res = `${String(query.resolution).replace(/p$/i, '')}p`
      const matching = results.filter(r => r.title.includes(res))
      if (matching.length) results = matching
    }

    return results.sort((a, b) => b.seeders - a.seeders)
  }

  async single (query, options = {}) {
    return this.run(query, options, { episode: query.episode, kind: 'single' })
  }

  async batch (query, options = {}) {
    return this.run(query, options, { episode: null, kind: 'batch' })
  }

  async movie (query, options = {}) {
    return this.run(query, options, { episode: null, kind: 'movie' })
  }

  async test (query, options = {}) {
    const cfg = this.cfg(options)
    const doFetch = query?.fetch || fetch
    try {
      const res = await doFetch(`${cfg.domain}/?page=rss&c=0_0&f=0&u=${encodeURIComponent(cfg.user)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return true
    } catch (e) {
      throw new Error(
        `No se pudo conectar con ${cfg.domain}. Si Nyaa está bloqueado en tu red, cambiá la opción "domain" por un mirror.`
      )
    }
  }
})()
