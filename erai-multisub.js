// Erai-raws MultiSub — extensión de fuente torrent para Hayase.
// Busca en Nyaa solo las subidas de Erai-raws (por defecto) y deja solo los
// releases [MultiSub], que son los que suelen traer varias pistas de subtítulos.
// Los subs en español hay que elegirlos desde el reproductor de Hayase.

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
  multiSubOnly: true
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

// Un release de episodio suelto lleva " - 05 [" o " - 05v2 [" en el nombre.
const SINGLE_EP = /\s-\s\d{1,4}(v\d)?\s*\[/

function parseRss (xml, group) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || []
  const out = []
  for (const item of items) {
    const title = tag(item, 'title')
    const hash = tag(item, 'nyaa:infoHash').toLowerCase()
    if (!title || !hash) continue
    if (group && !title.toLowerCase().startsWith(`[${group.toLowerCase()}]`)) continue
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

// ---------- extensión ----------

export default new (class EraiMultiSub {
  cfg (options = {}) {
    return {
      domain: (options.domain || DEFAULTS.domain).replace(/\/+$/, ''),
      user: options.user || DEFAULTS.user,
      multiSubOnly: options.multiSubOnly ?? DEFAULTS.multiSubOnly
    }
  }

  // Prueba varias formas de pedir el RSS filtrado por usuario; si Nyaa ignora el
  // filtro, igual se filtra por el prefijo [Erai-raws] del título.
  async fetchRss (query, q, cfg) {
    const doFetch = query?.fetch || fetch
    const enc = encodeURIComponent(q)
    const urls = [
      `${cfg.domain}/?page=rss&c=0_0&f=0&u=${encodeURIComponent(cfg.user)}&q=${enc}`,
      `${cfg.domain}/user/${encodeURIComponent(cfg.user)}?page=rss&c=0_0&f=0&q=${enc}`,
      `${cfg.domain}/?page=rss&c=0_0&f=0&q=${enc}%20${encodeURIComponent(cfg.user)}`
    ]
    for (const url of urls) {
      try {
        const res = await doFetch(url)
        if (!res.ok) continue
        const text = await res.text()
        if (!/<rss|<item/i.test(text)) continue
        const results = parseRss(text, cfg.user)
        if (results.length) return results
      } catch (e) {
        // probar la siguiente URL
      }
    }
    return []
  }

  queriesFor (titles = [], episode) {
    const seen = new Set()
    const base = []
    for (const t of titles) {
      const c = clean(t)
      if (c && !seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase())
        base.push(c)
      }
      if (base.length >= 3) break
    }
    const ep = episode ? ` ${pad(episode)}` : ''
    const full = base.map(t => t + ep)
    // Erai-raws abrevia los títulos: de respaldo, las primeras 2-3 palabras.
    const short = base
      .map(t => t.split(' ').slice(0, 3).join(' '))
      .filter(t => t && !seen.has(t.toLowerCase()))
      .map(t => t + ep)
    return { full, short: [...new Set(short)] }
  }

  async run (query, options, { episode, kind }) {
    const cfg = this.cfg(options)
    if (!query?.titles?.length) return []
    const { full, short } = this.queriesFor(query.titles, episode)

    const gather = async qs => {
      const settled = await Promise.allSettled(qs.map(q => this.fetchRss(query, q, cfg)))
      return settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    }

    let results = await gather(full)
    if (!results.length) results = await gather(short)

    // Quitar duplicados por hash
    const byHash = new Map()
    for (const r of results) if (!byHash.has(r.hash)) byHash.set(r.hash, r)
    results = [...byHash.values()]

    if (cfg.multiSubOnly) results = results.filter(r => /multi.?sub/i.test(r.title))

    if (kind === 'single' && episode) {
      const epRe = new RegExp(`\\s-\\s0*${Number(episode)}(v\\d)?\\s*\\[`)
      results = results.filter(r => epRe.test(r.title))
    } else if (kind === 'batch') {
      results = results.filter(r => !SINGLE_EP.test(r.title))
    }

    if (query.exclusions?.length) {
      const ex = query.exclusions.map(e => String(e).toLowerCase()).filter(Boolean)
      results = results.filter(r => !ex.some(e => r.title.toLowerCase().includes(e)))
    }

    // Preferir la resolución pedida, pero no dejar la lista vacía por eso.
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
