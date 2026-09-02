/** Display/filter only — never added to safety score. */
export const POPULAR_TEAM_NAMES = [
  'manchester united',
  'manchester city',
  'liverpool',
  'chelsea',
  'arsenal',
  'tottenham',
  'real madrid',
  'barcelona',
  'atletico madrid',
  'bayern munich',
  'bayern munchen',
  'bayern',
  'borussia dortmund',
  'dortmund',
  'juventus',
  'inter',
  'ac milan',
  'napoli',
  'paris saint germain',
  'psg',
  'ajax',
  'psv',
  'feyenoord',
  'benfica',
  'porto',
  'sporting',
  'galatasaray',
  'fenerbahce',
  'besiktas',
  'celtic',
  'rangers',
  'aston villa',
  'newcastle',
  'west ham',
  'brighton',
  'crystal palace',
  'everton',
  'fulham',
  'sevilla',
  'villarreal',
  'real sociedad',
  'athletic',
  'roma',
  'lazio',
  'atalanta',
  'fiorentina',
  'bayer leverkusen',
  'leverkusen',
  'rb leipzig',
  'leipzig',
  'eintracht frankfurt',
  'marseille',
  'monaco',
  'lyon',
  'lille',
  'nice',
  'al hilal',
  'super eagles',
  'nigeria',
  'ghana',
  'senegal',
  'egypt',
  'morocco',
];

export function foldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPopularTeam(name: string): boolean {
  const n = foldName(name);
  return POPULAR_TEAM_NAMES.some((p) => {
    const needle = foldName(p);
    return n.includes(needle) || needle.includes(n);
  });
}

/** Top-flight leagues used for booking slips — not every competition. */
export const RELIABLE_LEAGUE_NEEDLES = [
  'premier league',
  'epl',
  'la liga',
  'primera division',
  'serie a',
  'bundesliga',
  'ligue 1',
  'champions league',
  'europa league',
  'conference league',
  'fa cup',
  'efl cup',
  'league cup',
  'carabao',
  'copa del rey',
  'coppa italia',
  'dfb pokal',
  'coupe de france',
  'eredivisie',
  'primeira liga',
  'liga portugal',
  'liga nos',
  'super lig',
  'superlig',
];

export function isReliableLeague(league: string): boolean {
  const n = foldName(league);
  if (/2 bundesliga|bundesliga 2\b|serie b\b|ligue 2\b|championship|\bliga 2\b/.test(n)) {
    return false;
  }
  return RELIABLE_LEAGUE_NEEDLES.some((p) => n.includes(foldName(p)));
}

/** Countries whose top division should lead the Today board. */
export const TOP_COUNTRIES = [
  'England',
  'Spain',
  'Italy',
  'Germany',
  'France',
  'Europe',
  'Netherlands',
  'Portugal',
  'Belgium',
  'Turkey',
  'Scotland',
  'Brazil',
  'Argentina',
  'USA',
  'Mexico',
  'Saudi Arabia',
  'Nigeria',
] as const;

const TOP_DIVISION: Record<string, RegExp> = {
  england: /\bpremier league\b|\bepl\b/i,
  spain: /la liga|spanish primera/i,
  italy: /\bserie a\b/i,
  germany: /bundesliga/i,
  france: /ligue 1/i,
  netherlands: /eredivisie/i,
  portugal: /primeira liga|liga portugal(?!\s*2)|liga nos|liga bwin|liga betclic/i,
  belgium: /jupiler|belgian pro/i,
  turkey: /super lig|superlig|trendyol super/i,
  scotland: /scottish premiership|cinch premiership/i,
  brazil: /brasileirao|campeonato brasileiro|serie a brazil|\bserie a\b/i,
  argentina: /liga profesional|copa de la liga/i,
  usa: /\bmls\b|major league soccer/i,
  mexico: /liga mx/i,
  'saudi arabia': /saudi pro|saudi professional|roshn/i,
  nigeria: /npfl|nigerian professional|nigerian?\s*premier/i,
  europe: /champions league|europa league|conference league/i,
};

export function topCountryRank(country?: string): number {
  const n = (country || '').trim().toLowerCase();
  const i = TOP_COUNTRIES.findIndex((c) => c.toLowerCase() === n);
  return i >= 0 ? i : 80;
}

/** Top-flight league in a widely followed country — not Championship / Serie B / Ligue 2. */
export function isTopLeague(league: string, country?: string): boolean {
  const n = league.trim();
  if (!n) return false;
  const folded = foldName(n);
  if (/esport|e-?sport|virtual|u-?19|u-?21|youth|women|femenil|feminin|reserva|\bii\b/i.test(n)) {
    return false;
  }
  if (
    /2\.?\s*bundesliga|bundesliga\s*2|serie b\b|ligue 2\b|championship|segunda|league one|league two|efl cup|eerste divisie|liga portugal 2|tff 1\.?\s*lig/i.test(
      n,
    ) ||
    /eerste divisie|liga portugal 2|tff 1 lig/.test(folded)
  ) {
    return false;
  }
  if (
    /champions league|europa league|conference league/i.test(n) ||
    /champions league|europa league|conference league/.test(folded)
  ) {
    return true;
  }
  const c = (country || leagueCountry(n)).toLowerCase();
  const re = TOP_DIVISION[c];
  return Boolean(re && (re.test(n) || re.test(folded)));
}

export function leagueFamily(league: string): string {
  const n = foldName(league);
  if (n.includes('eredivisie')) return 'eredivisie';
  if (n.includes('primeira') || n.includes('liga portugal') || n.includes('liga nos')) return 'portugal';
  if (n.includes('super lig') || n.includes('superlig')) return 'superlig';
  if (n.includes('premier')) return 'epl';
  if (n.includes('la liga') || n.includes('primera')) return 'laliga';
  if (n.includes('serie a')) return 'seriea';
  if (n.includes('bundesliga')) return 'bundesliga';
  if (n.includes('ligue 1')) return 'ligue1';
  if (n.includes('champions')) return 'ucl';
  if (n.includes('conference')) return 'uecl';
  if (n.includes('europa')) return 'uel';
  return n || league.trim().toLowerCase();
}

const LEAGUE_COUNTRY_RULES: Array<[RegExp, string]> = [
  [/scottish|cinch premiership|scottish cup/i, 'Scotland'],
  [/welsh|cymru premier|jd cymru/i, 'Wales'],
  [/irish premiership|nifl|northern ireland/i, 'Northern Ireland'],
  [/league of ireland|sse airtricity/i, 'Ireland'],
  [/npfl|nigerian professional|nigeria premier|nigeria/i, 'Nigeria'],
  [/ghana premier|ghana/i, 'Ghana'],
  [/egyptian premier|egypt/i, 'Egypt'],
  [/botola|morocco/i, 'Morocco'],
  [/south african premier|dstv premiership|betway premiership|south africa/i, 'South Africa'],
  [/tunisian ligue|cl tunisie|tunisia/i, 'Tunisia'],
  [/algerian ligue|algeria/i, 'Algeria'],
  [/kenyan premier|kenya/i, 'Kenya'],
  [/ivory coast|ligue 1 cote/i, 'Ivory Coast'],
  [/cameroon elite|cameroon/i, 'Cameroon'],
  [/senegal premier|ligue 1 senegal|senegal/i, 'Senegal'],
  [/serie a brazil|brasileirao|campeonato brasileiro|brazil/i, 'Brazil'],
  [/liga profesional argentina|primera division argentina|copa de la liga|argentina/i, 'Argentina'],
  [/liga mx|liga bbva mx|mexico/i, 'Mexico'],
  [/major league soccer|\bmls\b/i, 'USA'],
  [/categoria primera|liga betplay|colombia/i, 'Colombia'],
  [/chilean primera|campeonato nacional chile|chile/i, 'Chile'],
  [/uruguayan primera|liga auf|uruguay/i, 'Uruguay'],
  [/liga pro ecuador|ecuador/i, 'Ecuador'],
  [/liga 1 peru|peru/i, 'Peru'],
  [/j1 league|j2 league|j\.league|japan/i, 'Japan'],
  [/k league|south korea/i, 'South Korea'],
  [/chinese super league|\bcsl\b/i, 'China'],
  [/saudi pro|saudi professional|roshn saudi|saudi arabia/i, 'Saudi Arabia'],
  [/uae pro|arabian gulf league|adnoc pro/i, 'UAE'],
  [/qatar stars/i, 'Qatar'],
  [/indian super league|\bisl\b/i, 'India'],
  [/a-league|australia/i, 'Australia'],
  [/persian gulf pro|iran/i, 'Iran'],
  [/thai league|thailand/i, 'Thailand'],
  [/eredivisie|knvb|eerste divisie|netherlands|holland/i, 'Netherlands'],
  [/primeira liga|liga portugal|liga nos|liga bwin|liga betclic|taca de portugal|portugal/i, 'Portugal'],
  [/jupiler|belgian pro/i, 'Belgium'],
  [/super lig|superlig|trendyol|turkiye|turkish cup|turkey/i, 'Turkey'],
  [/champions league|europa league|conference league|nations league|uefa/i, 'Europe'],
  [/super league 1|super league greece|greek cup/i, 'Greece'],
  [/1\. liga|czech first league/i, 'Czech Republic'],
  [/first division a/i, 'Belgium'],
  [/professional football league|npfl/i, 'Nigeria'],
  [/premier soccer league|dstv premiership/i, 'South Africa'],
  [/botola pro|botola/i, 'Morocco'],
  [/primera a|liga betplay/i, 'Colombia'],
  [/liga de primera/i, 'Chile'],
  [/v-league/i, 'Vietnam'],
  [/indian super league/i, 'India'],
  [/indonesia super league|liga 1 indonesia/i, 'Indonesia'],
  [/russian premier|\brpl\b/i, 'Russia'],
  [/ukrainian premier|\bupl\b/i, 'Ukraine'],
  [/ekstraklasa|poland/i, 'Poland'],
  [/fortuna liga|czech/i, 'Czech Republic'],
  [/\bhnl\b|croatian/i, 'Croatia'],
  [/liga 1 romania|romanian/i, 'Romania'],
  [/austrian bundesliga|admiral bundesliga/i, 'Austria'],
  [/swiss super league|raiffeisen/i, 'Switzerland'],
  [/superliga denmark|danish superliga/i, 'Denmark'],
  [/allsvenskan|sweden/i, 'Sweden'],
  [/eliteserien|norway/i, 'Norway'],
  [/veikkausliiga|finland/i, 'Finland'],
  [/super liga serbia|mozzart/i, 'Serbia'],
  [/\bnb i\b|otp bank liga/i, 'Hungary'],
  [/parva liga|bulgarian/i, 'Bulgaria'],
  [/israeli premier|ligat haal/i, 'Israel'],
  [/la liga|spanish primera|copa del rey|segunda division/i, 'Spain'],
  [/serie a|serie b|coppa italia|serie c/i, 'Italy'],
  [/bundesliga|dfb pokal|3\.?\s*liga/i, 'Germany'],
  [/ligue 1|ligue 2|coupe de france|coupe de la ligue/i, 'France'],
  [/english premier|\bepl\b|fa cup|\befl\b|carabao|efl championship|sky bet championship|english championship|^premier league$|\befl league one\b|\befl league two\b|vanarama/i, 'England'],
  [/caf champions|caf confederation|africa cup|afcon/i, 'Africa'],
  [/copa libertadores|copa sudamericana|conmebol/i, 'South America'],
  [/concacaf|gold cup/i, 'North America'],
  [/afc champions|asian cup/i, 'Asia'],
  [/world cup|olympics/i, 'World'],
];

const COUNTRY_ISO: Record<string, string> = {
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  ireland: 'IE',
  spain: 'ES',
  italy: 'IT',
  germany: 'DE',
  france: 'FR',
  netherlands: 'NL',
  portugal: 'PT',
  belgium: 'BE',
  turkey: 'TR',
  greece: 'GR',
  russia: 'RU',
  ukraine: 'UA',
  poland: 'PL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  croatia: 'HR',
  romania: 'RO',
  austria: 'AT',
  switzerland: 'CH',
  denmark: 'DK',
  sweden: 'SE',
  norway: 'NO',
  finland: 'FI',
  serbia: 'RS',
  hungary: 'HU',
  bulgaria: 'BG',
  slovakia: 'SK',
  slovenia: 'SI',
  bosnia: 'BA',
  'bosnia and herzegovina': 'BA',
  albania: 'AL',
  northmacedonia: 'MK',
  macedonia: 'MK',
  montenegro: 'ME',
  kosovo: 'XK',
  israel: 'IL',
  nigeria: 'NG',
  ghana: 'GH',
  egypt: 'EG',
  morocco: 'MA',
  'south africa': 'ZA',
  tunisia: 'TN',
  algeria: 'DZ',
  kenya: 'KE',
  'ivory coast': 'CI',
  "cote d ivoire": 'CI',
  cameroon: 'CM',
  senegal: 'SN',
  mali: 'ML',
  uganda: 'UG',
  zambia: 'ZM',
  zimbabwe: 'ZW',
  angola: 'AO',
  mozambique: 'MZ',
  tanzania: 'TZ',
  ethiopia: 'ET',
  rwanda: 'RW',
  'dr congo': 'CD',
  congo: 'CG',
  gabon: 'GA',
  guinea: 'GN',
  'burkina faso': 'BF',
  togo: 'TG',
  benin: 'BJ',
  brazil: 'BR',
  argentina: 'AR',
  mexico: 'MX',
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  canada: 'CA',
  colombia: 'CO',
  chile: 'CL',
  uruguay: 'UY',
  ecuador: 'EC',
  peru: 'PE',
  paraguay: 'PY',
  bolivia: 'BO',
  venezuela: 'VE',
  japan: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  china: 'CN',
  'saudi arabia': 'SA',
  uae: 'AE',
  'united arab emirates': 'AE',
  qatar: 'QA',
  india: 'IN',
  australia: 'AU',
  iran: 'IR',
  thailand: 'TH',
  indonesia: 'ID',
  malaysia: 'MY',
  vietnam: 'VN',
  singapore: 'SG',
  'new zealand': 'NZ',
  'hong kong': 'HK',
  taiwan: 'TW',
  iraq: 'IQ',
  jordan: 'JO',
  lebanon: 'LB',
  kuwait: 'KW',
  bahrain: 'BH',
  oman: 'OM',
  uzbekistan: 'UZ',
  kazakhstan: 'KZ',
  azerbaijan: 'AZ',
  georgia: 'GE',
  armenia: 'AM',
  cyprus: 'CY',
  malta: 'MT',
  iceland: 'IS',
  'faroe islands': 'FO',
  luxembourg: 'LU',
  andorra: 'AD',
  gibraltar: 'GI',
  'san marino': 'SM',
  liechtenstein: 'LI',
  moldova: 'MD',
  belarus: 'BY',
  lithuania: 'LT',
  latvia: 'LV',
  estonia: 'EE',
  'costa rica': 'CR',
  panama: 'PA',
  honduras: 'HN',
  'el salvador': 'SV',
  guatemala: 'GT',
  jamaica: 'JM',
  haiti: 'HT',
  'trinidad and tobago': 'TT',
  europe: 'EU',
};

const CCODE_COUNTRY: Record<string, string> = {
  alb: 'Albania',
  alg: 'Algeria',
  arg: 'Argentina',
  arm: 'Armenia',
  aus: 'Australia',
  aut: 'Austria',
  bel: 'Belgium',
  bra: 'Brazil',
  bul: 'Bulgaria',
  chi: 'Chile',
  chn: 'China',
  col: 'Colombia',
  cro: 'Croatia',
  cze: 'Czech Republic',
  den: 'Denmark',
  egy: 'Egypt',
  eng: 'England',
  esp: 'Spain',
  fin: 'Finland',
  fra: 'France',
  ger: 'Germany',
  gha: 'Ghana',
  gre: 'Greece',
  hun: 'Hungary',
  ind: 'India',
  idn: 'Indonesia',
  int: 'International',
  irl: 'Ireland',
  isr: 'Israel',
  ita: 'Italy',
  jpn: 'Japan',
  mas: 'Malaysia',
  mex: 'Mexico',
  mar: 'Morocco',
  nga: 'Nigeria',
  nir: 'Northern Ireland',
  nor: 'Norway',
  nld: 'Netherlands',
  ned: 'Netherlands',
  per: 'Peru',
  pol: 'Poland',
  por: 'Portugal',
  prt: 'Portugal',
  qat: 'Qatar',
  rou: 'Romania',
  rus: 'Russia',
  ksa: 'Saudi Arabia',
  sco: 'Scotland',
  srb: 'Serbia',
  sin: 'Singapore',
  rsa: 'South Africa',
  swe: 'Sweden',
  sui: 'Switzerland',
  tha: 'Thailand',
  tur: 'Turkey',
  ukr: 'Ukraine',
  uae: 'UAE',
  usa: 'USA',
  vie: 'Vietnam',
  wal: 'Wales',
};

const SPECIAL_FLAGS: Record<string, string> = {
  england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  europe: '🇪🇺',
  africa: '🌍',
  'south america': '🌎',
  'north america': '🌎',
  asia: '🌏',
  world: '🌐',
  international: '🌐',
};

function isoToFlag(iso: string): string {
  const up = iso.toUpperCase();
  if (up.length !== 2) return '';
  const a = up.charCodeAt(0);
  const b = up.charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return '';
  return String.fromCodePoint(127397 + a, 127397 + b);
}

export function normalizeCountryName(raw: string): string {
  const n = foldName(raw);
  if (!n) return '';
  const fromCcode = CCODE_COUNTRY[n];
  if (fromCcode) return fromCcode;
  if (/^(uk|united kingdom|great britain|britain)$/.test(n)) return 'England';
  if (/^(usa|united states|united states of america|us)$/.test(n)) return 'USA';
  if (/^(uae|united arab emirates)$/.test(n)) return 'UAE';
  if (/^(ivory coast|cote d ivoire)$/.test(n)) return 'Ivory Coast';
  if (/^(czech republic|czechia)$/.test(n)) return 'Czech Republic';
  if (/^(south korea|korea republic|korea)$/.test(n)) return 'South Korea';
  if (/^(the netherlands|holland|ned|nld)$/.test(n)) return 'Netherlands';
  if (/^(por|prt)$/.test(n)) return 'Portugal';
  if (/^(tur|turkiye)$/.test(n)) return 'Turkey';
  if (/^(ger|deu)$/.test(n)) return 'Germany';
  if (/^(eng)$/.test(n)) return 'England';
  if (/^(esp)$/.test(n)) return 'Spain';
  if (/^(ita)$/.test(n)) return 'Italy';
  if (/^(fra)$/.test(n)) return 'France';
  if (/^(rep of ireland|republic of ireland)$/.test(n)) return 'Ireland';
  return raw.trim();
}

export function countryFlag(country: string): string {
  const n = foldName(country);
  if (!n) return '';
  if (SPECIAL_FLAGS[n]) return SPECIAL_FLAGS[n];
  const iso = COUNTRY_ISO[n];
  return iso ? isoToFlag(iso) : '';
}

function isVagueCountryName(country: string): boolean {
  const n = foldName(country);
  return /^(world|international|europe|global|int|africa|asia|south america|north america)$/.test(n);
}

export function leagueCountry(league: string, feedCountry?: string): string {
  const feed = feedCountry?.trim();
  if (feed) {
    const fromFeed = normalizeCountryName(feed);
    if (fromFeed && !isVagueCountryName(fromFeed)) return fromFeed;
  }
  const folded = foldName(league);
  for (const [re, country] of LEAGUE_COUNTRY_RULES) {
    if (re.test(league) || re.test(folded)) return country;
  }
  if (feed) {
    const fromFeed = normalizeCountryName(feed);
    if (fromFeed) return fromFeed;
  }
  return 'International';
}

export function leagueHeading(league: string, country?: string): string {
  const resolved = country || leagueCountry(league);
  const flag = countryFlag(resolved);
  const name = league.trim() || 'League';
  return flag ? `${flag} ${resolved} · ${name}` : `${resolved} · ${name}`;
}

/** Keep friendlies and lower divisions; drop virtual/esports noise. */
export function isListedFootball(league: string): boolean {
  const n = league.trim().toLowerCase();
  if (!n) return false;
  if (/esport|e-?sport|fifa \d|virtual football|simulated/i.test(n)) return false;
  return true;
}

export function localDayKey(isoOrDate: string | Date = new Date()): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '9999-12-31';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function utcDayKey(isoOrDate: string | Date = new Date()): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '9999-12-31';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** True when kickoff falls on "today" in local time or UTC (covers TZ splits near midnight). */
export function isOnCalendarDay(
  kickoffUtc: string | Date | undefined,
  now = new Date(),
  which: 'today' | 'tomorrow' = 'today',
): boolean {
  const target = new Date(now.getTime());
  if (which === 'tomorrow') target.setDate(target.getDate() + 1);
  if (kickoffUtc == null || kickoffUtc === '') return which === 'today';
  const d = typeof kickoffUtc === 'string' ? new Date(kickoffUtc) : kickoffUtc;
  if (Number.isNaN(d.getTime())) return which === 'today';
  return localDayKey(d) === localDayKey(target) || utcDayKey(d) === utcDayKey(target);
}

export function matchDayRank(kickoffUtc: string, now = new Date()): number {
  const key = localDayKey(kickoffUtc);
  const today = localDayKey(now);
  const tmr = new Date(now.getTime());
  tmr.setDate(tmr.getDate() + 1);
  const tomorrow = localDayKey(tmr);
  if (key === today) return 0;
  if (key === tomorrow) return 1;
  return 2;
}

/** Today first, then tomorrow, then later dates, then kickoff time. */
export function compareByMatchDay(aKickoff: string, bKickoff: string, now = new Date()): number {
  const ra = matchDayRank(aKickoff, now);
  const rb = matchDayRank(bKickoff, now);
  if (ra !== rb) return ra - rb;
  const da = localDayKey(aKickoff);
  const db = localDayKey(bKickoff);
  if (da !== db) return da.localeCompare(db);
  return aKickoff.localeCompare(bKickoff);
}

/** Markets allowed on auto slips — not a default to under 2.5. */
export const HIGH_DELIVERY_MARKETS = [
  'OVER_2_5',
  'OVER_1_5',
  'OVER_3_5',
  'BTTS_YES',
  'BTTS_NO',
  'UNDER_2_5',
  'DC_1X',
  'DC_X2',
  'HOME',
  'AWAY',
  'HOME_OVER_1_5',
  'AWAY_OVER_1_5',
  'HOME_TO_SCORE',
  'DNB_HOME',
  'OVER_10_5_CORNERS',
  'UNDER_10_5_CORNERS',
  'OVER_3_5_CARDS',
  'UNDER_3_5_CARDS',
  'HOME_PLAYER_SCORE',
  'AWAY_PLAYER_SCORE',
] as const;

export const MARKET_LABELS: Record<string, string> = {
  HOME: 'Home win',
  DRAW: 'Draw',
  AWAY: 'Away win',
  DC_1X: 'Double chance 1X',
  DC_X2: 'Double chance X2',
  DC_12: 'Double chance 12',
  OVER_0_5: 'Over 0.5 goals',
  OVER_1_5: 'Over 1.5 goals',
  OVER_2_5: 'Over 2.5 goals',
  OVER_3_5: 'Over 3.5 goals',
  OVER_4_5: 'Over 4.5 goals',
  UNDER_0_5: 'Under 0.5 goals',
  UNDER_1_5: 'Under 1.5 goals',
  UNDER_2_5: 'Under 2.5 goals',
  UNDER_3_5: 'Under 3.5 goals',
  UNDER_4_5: 'Under 4.5 goals',
  BTTS_YES: 'BTTS yes',
  BTTS_NO: 'BTTS no',
  HOME_TO_SCORE: 'Home to score',
  AWAY_TO_SCORE: 'Away to score',
  HOME_OVER_0_5: 'Home over 0.5 goals',
  HOME_OVER_1_5: 'Home over 1.5 goals',
  AWAY_OVER_0_5: 'Away over 0.5 goals',
  AWAY_OVER_1_5: 'Away over 1.5 goals',
  DNB_HOME: 'Home draw no bet',
  DNB_AWAY: 'Away draw no bet',
  AH_HOME_0: 'Home handicap 0',
  AH_AWAY_0: 'Away handicap 0',
  AH_HOME_M05: 'Home -0.5',
  AH_HOME_P05: 'Home +0.5',
  AH_HOME_M15: 'Home -1.5',
  AH_HOME_P15: 'Home +1.5',
  OVER_10_5_CORNERS: 'Over 10.5 corners',
  UNDER_10_5_CORNERS: 'Under 10.5 corners',
  OVER_3_5_CARDS: 'Over 3.5 yellow cards',
  UNDER_3_5_CARDS: 'Under 3.5 yellow cards',
  HOME_PLAYER_SCORE: 'Home player to score',
  AWAY_PLAYER_SCORE: 'Away player to score',
  HOME_MULTISCORE: 'Home multiscore 2-0, 2-1, 3-0, 3-1',
  AWAY_MULTISCORE: 'Away multiscore 0-2, 1-2, 0-3, 1-3',
};
