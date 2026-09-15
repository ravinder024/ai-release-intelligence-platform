import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  fetchProtectedResource,
  type Configuration,
} from "openid-client";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
const GOOGLE_USERINFO = new URL("https://openidconnect.googleapis.com/v1/userinfo");
const SCOPES = "openid email profile";

let configurationPromise: Promise<Configuration> | null = null;

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error("Google OIDC is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.");
  }
  if (!configurationPromise) {
    configurationPromise = discovery(GOOGLE_ISSUER, clientId, {
      client_secret: clientSecret,
      redirect_uris: [callbackUrl],
    });
  }
  return { configuration: configurationPromise, callbackUrl };
}

export async function createGoogleAuthorizationRequest() {
  const { configuration, callbackUrl } = getConfig();
  const [config, codeVerifier] = await Promise.all([configuration, Promise.resolve(randomPKCECodeVerifier())]);
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = randomState();
  const nonce = randomNonce();
  const url = buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: SCOPES,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });
  return { url, state, nonce, codeVerifier };
}

export async function exchangeGoogleAuthorizationCode(args: {
  currentUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}) {
  const { configuration } = getConfig();
  const config = await configuration;
  const tokens = await authorizationCodeGrant(config, args.currentUrl, {
    expectedState: args.state,
    expectedNonce: args.nonce,
    pkceCodeVerifier: args.codeVerifier,
  });
  const userInfoResponse = await fetchProtectedResource(config, tokens.access_token, GOOGLE_USERINFO, "GET");
  if (!userInfoResponse.ok) throw new Error("Google userinfo request failed.");
  const userInfo = await userInfoResponse.json() as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!userInfo.sub || !userInfo.email || userInfo.email_verified !== true) {
    throw new Error("Google did not provide a verified identity.");
  }
  return {
    issuer: GOOGLE_ISSUER.href,
    subject: userInfo.sub,
    email: userInfo.email.toLowerCase(),
    emailVerified: true,
    displayName: userInfo.name?.trim() || userInfo.email.split("@")[0],
  };
}
