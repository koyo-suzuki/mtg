const { getRows } = require('./sheets-client');

const CONFIG_SPREADSHEET_ID = process.env.CONFIG_SPREADSHEET_ID;

// Simple in-memory cache with TTL
const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.time < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache(key, data) {
  cache[key] = { data, time: Date.now() };
}

/**
 * Get all users from config_users sheet
 * Returns: [{ email, role, castName, selectedStore }]
 */
async function getAllUsers() {
  const cached = getCached('users');
  if (cached) return cached;

  const rows = await getRows(CONFIG_SPREADSHEET_ID, 'config_users!A2:F500');
  const users = rows
    .filter(r => r[0]) // skip empty rows
    .map(r => ({
      email: (r[0] || '').trim().toLowerCase(),
      role: (r[1] || '').trim(),
      selectedStore: (r[4] || '').trim(),
      castName: (r[5] || '').trim(),
    }));

  setCache('users', users);
  return users;
}

/**
 * Get a user by email
 * Maps roles: cast -> cast, cast_manager -> cast_manager, everything else -> admin
 */
async function getUserByEmail(email) {
  const users = await getAllUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return null;

  // ロールをそのまま保持（cast, cast_manager, senior_manager, manager, executive 等）
  const appRole = user.role || 'cast';

  return {
    email: user.email,
    role: appRole,
    castName: user.castName,
    selectedStore: user.selectedStore,
  };
}

/**
 * Get all cast members (role = cast or cast_manager)
 */
async function getCastMembers() {
  const users = await getAllUsers();
  return users
    .filter(u => u.castName) // castNameがあるユーザーは全員追加可能
    .map(u => ({
      gmail: u.email,
      castName: u.castName,
      role: u.role,
    }));
}

/**
 * Get all active stores from config_stores sheet
 * Returns: [{ code, name, area, areaCode, order }]
 */
async function getStores() {
  const cached = getCached('stores');
  if (cached) return cached;

  const rows = await getRows(CONFIG_SPREADSHEET_ID, 'config_stores!A2:F20');
  const stores = rows
    .filter(r => r[0] && r[0].toUpperCase() === 'TRUE')
    .map(r => ({
      code: (r[1] || '').trim(),
      name: (r[2] || '').trim(),
      area: (r[3] || '').trim(),
      areaCode: (r[4] || '').trim(),
      order: parseInt(r[5] || '0'),
    }))
    .sort((a, b) => a.order - b.order);

  setCache('stores', stores);
  return stores;
}

/**
 * Invalidate cache (useful when data changes)
 */
function invalidateCache(key) {
  if (key) {
    delete cache[key];
  } else {
    Object.keys(cache).forEach(k => delete cache[k]);
  }
}

module.exports = { getAllUsers, getUserByEmail, getCastMembers, getStores, invalidateCache };
