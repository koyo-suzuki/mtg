const AIRREGI_STORE_NAME_CANDIDATES = {
  store_001: ['Bisquedoll', 'ビスクドール', 'ビスク新宿'],
  store_002: ['Bisquedoll OSAKA', 'Bisquedoll大阪', 'ビスク大阪'],
  store_003: ['Rozengarden', 'ローゼンガーデン', 'ローゼン新宿'],
  store_004: ['Galette', 'ガレット大阪'],
  store_005: ['Revelio', 'Revelio渋谷', 'レベリオ渋谷'],
  store_006: ['Revelio新宿', 'Revelio SHINJUKU', 'レベリオ新宿'],
  store_007: ['ギャルカフェ10sion', '10sion本店', 'ギャル渋谷'],
  store_008: ['ギャルカフェ10sion 超はなれ大阪店', '10sion超はなれ', 'ギャル大阪'],
  store_009: ['Revelio OSAKA', 'Revelio大阪', 'レベリオ大阪'],
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function buildAirregiStoreTargets(stores, requestedStoreCodes = []) {
  const requested = new Set(requestedStoreCodes.filter(Boolean));
  return stores
    .filter(store => !requested.size || requested.has(store.code))
    .map(store => ({
      ...store,
      airregiNameCandidates: AIRREGI_STORE_NAME_CANDIDATES[store.code] || [store.name],
    }))
    .filter(store => store.airregiNameCandidates.length > 0);
}

function getMissingStoreCodes(stores, requestedStoreCodes = []) {
  const known = new Set(stores.map(store => store.code));
  return requestedStoreCodes.filter(code => code && !known.has(code));
}

module.exports = {
  AIRREGI_STORE_NAME_CANDIDATES,
  buildAirregiStoreTargets,
  getMissingStoreCodes,
  normalizeText,
};
