const { OAuth2Client } = require('google-auth-library');
const { getUserByEmail } = require('../sheets/config-reader');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Verify a Google ID Token and return user payload
 */
async function verifyGoogleToken(idToken) {
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
}

/**
 * Express middleware: verify Authorization header and attach req.user
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '認証が必要です' });
  }

  const idToken = authHeader.slice(7);

  try {
    const payload = await verifyGoogleToken(idToken);
    const email = payload.email;

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(403).json({ success: false, error: '登録されていないアカウントです' });
    }

    req.user = {
      email: user.email,
      role: user.role,
      castName: user.castName,
      displayName: user.castName || payload.name || email,
      googleName: payload.name || '',
      selectedStore: user.selectedStore,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ success: false, error: '認証に失敗しました' });
  }
}

module.exports = { verifyGoogleToken, authMiddleware };
