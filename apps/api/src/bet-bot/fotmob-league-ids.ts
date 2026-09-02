/** FotMob league IDs — top divisions and major cups across all continents. */
export const FOTMOB_LEAGUE_IDS: number[] = [
  // England & UK
  47, 48, 64, 116, 129,
  // Spain, Italy, Germany, France
  87, 55, 54, 53,
  // Netherlands, Portugal, Turkey, Belgium
  57, 61, 71, 40,
  // Central & Eastern Europe
  196, 122, 135, 212, 38, 182, 189, 63, 441, 252, 270, 260,
  // Nordics & Ireland
  67, 59, 46, 51, 126,
  // Switzerland
  69,
  // UEFA club competitions
  42, 73, 10216,
  // South America
  112, 268, 274, 273, 131,
  // North & Central America
  130, 230,
  // Africa
  533, 537, 522, 519, 530, 516,
  // Middle East
  536, 538, 535,
  // Asia
  223, 120, 9478, 8983, 8984, 9088, 461,
  // Oceania
  113,
  // Secondary divisions (more fixtures)
  8814, 8974, 123, 85, 168, 165,
];

/** FotMob 3-letter country code per league — used when match nodes omit ccode. */
export const FOTMOB_LEAGUE_COUNTRY: Record<number, string> = {
  47: 'ENG',
  48: 'ENG',
  64: 'SCO',
  116: 'WAL',
  129: 'NIR',
  87: 'ESP',
  55: 'ITA',
  54: 'GER',
  53: 'FRA',
  57: 'NED',
  61: 'POR',
  71: 'TUR',
  40: 'BEL',
  196: 'POL',
  122: 'CZE',
  135: 'GRE',
  212: 'HUN',
  38: 'AUT',
  182: 'SRB',
  189: 'ROU',
  63: 'RUS',
  441: 'UKR',
  252: 'CRO',
  270: 'BUL',
  260: 'ALB',
  67: 'SWE',
  59: 'NOR',
  46: 'DEN',
  51: 'FIN',
  126: 'IRL',
  69: 'SUI',
  42: 'INT',
  73: 'INT',
  10216: 'INT',
  112: 'ARG',
  268: 'BRA',
  274: 'COL',
  273: 'CHI',
  131: 'PER',
  130: 'USA',
  230: 'MEX',
  533: 'NGA',
  537: 'RSA',
  522: 'GHA',
  519: 'EGY',
  530: 'MAR',
  516: 'ALG',
  536: 'KSA',
  538: 'UAE',
  535: 'QAT',
  223: 'JPN',
  120: 'CHN',
  9478: 'IND',
  8983: 'IDN',
  8984: 'THA',
  9088: 'VIE',
  461: 'SIN',
  113: 'AUS',
  8814: 'BRA',
  8974: 'JPN',
  123: 'SCO',
  85: 'DEN',
  168: 'SWE',
  165: 'TUR',
};
