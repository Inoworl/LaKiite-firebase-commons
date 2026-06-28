import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { randomInt } from "crypto";
import * as https from "https";

const airbridgeTrackingLinkApiToken = defineSecret(
  "AIRBRIDGE_TRACKING_LINK_API_TOKEN"
);

const searchIdPattern = /^[a-zA-Z0-9]{8}$/;
const airbridgeTrackingLinkApiUrl =
  "https://api.airbridge.io/v1/tracking-links";
const devAndroidFallbackUrl =
  "https://appdistribution.firebase.google.com/testerapps/1:3311967889:android:70d7247f19e5f65438a930/releases/4aibmmfq1gh2g";
const devIosFallbackUrl = "https://testflight.apple.com/v1/app/6755344095";
const devDesktopFallbackUrl = "https://lakiite-flutter-app-dev.web.app";
const prodAndroidFallbackUrl =
  "https://play.google.com/store/apps/details?id=com.inoworl.lakiite";
const prodIosFallbackUrl = "https://apps.apple.com/jp/app/id6746154277";
const prodDesktopFallbackUrl = "https://lakiite-flutter-app-prod.web.app";
const customShortIdPrefix = "friend_";
const customShortIdRandomLength = 17;
const customShortIdAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const friendInviteLinkCacheVersion = 1;

type AppEnv = "dev" | "prod";

type AirbridgeTrackingLinkPayload = {
  channel: string;
  deeplinkUrl: string;
  isReengagement: "OFF";
  customShortId?: string;
  fallbackPaths: {
    android: string;
    ios: string;
    desktop: string;
  };
};

type AirbridgeTrackingLinkResponse = {
  data?: {
    trackingLink?: {
      shortUrl?: string;
      link?: {
        click?: string;
      };
    };
  };
};

type FriendInviteLinkCache = {
  uid?: unknown;
  env?: unknown;
  searchId?: unknown;
  url?: unknown;
  deeplinkUrl?: unknown;
  version?: unknown;
};

class FriendInviteLinkError extends Error {
  constructor(
    readonly status: number,
    readonly response: { error: string }
  ) {
    super(response.error);
  }
}

const appConfigByEnv: Record<
  AppEnv,
  {
    scheme: string;
    fallbackPaths: AirbridgeTrackingLinkPayload["fallbackPaths"];
  }
> = {
  dev: {
    scheme: "lakiitedev",
    fallbackPaths: {
      android: devAndroidFallbackUrl,
      ios: devIosFallbackUrl,
      desktop: devDesktopFallbackUrl,
    },
  },
  prod: {
    scheme: "lakiite",
    fallbackPaths: {
      android: prodAndroidFallbackUrl,
      ios: prodIosFallbackUrl,
      desktop: prodDesktopFallbackUrl,
    },
  },
};

function resolveAppEnv(projectId: string): AppEnv {
  switch (projectId) {
  case "lakiite-flutter-app-dev":
    return "dev";
  case "lakiite-flutter-app-prod":
    return "prod";
  default:
    throw new FriendInviteLinkError(500, {
      error: "招待リンク生成の環境設定が不正です",
    });
  }
}

export function buildFriendInviteDeeplinkUrl(
  searchId: string,
  projectId: string
): string {
  const { scheme } = appConfigByEnv[resolveAppEnv(projectId)];
  return `${scheme}://friend/search?searchId=${encodeURIComponent(searchId)}`;
}

function generateFriendInviteCustomShortId(): string {
  const suffix = Array.from({ length: customShortIdRandomLength }, () =>
    customShortIdAlphabet[randomInt(customShortIdAlphabet.length)]
  ).join("");
  return `${customShortIdPrefix}${suffix}`;
}

export function getReusableFriendInviteLinkUrl(
  cache: FriendInviteLinkCache | undefined,
  params: {
    uid: string;
    searchId: string;
    projectId: string;
  }
): string | undefined {
  if (!cache) {
    return undefined;
  }

  const env = resolveAppEnv(params.projectId);
  if (
    cache.uid !== params.uid ||
    cache.env !== env ||
    cache.searchId !== params.searchId ||
    cache.version !== friendInviteLinkCacheVersion ||
    typeof cache.url !== "string" ||
    cache.url.trim().length === 0
  ) {
    return undefined;
  }

  return cache.url;
}

async function getCachedFriendInviteLinkUrl(params: {
  uid: string;
  searchId: string;
  projectId: string;
}): Promise<string | undefined> {
  const cacheDoc = await admin
    .firestore()
    .collection("friendInviteLinks")
    .doc(params.uid)
    .get();

  return getReusableFriendInviteLinkUrl(cacheDoc.data(), params);
}

async function saveFriendInviteLinkCache(params: {
  uid: string;
  searchId: string;
  projectId: string;
  deeplinkUrl: string;
  url: string;
}): Promise<void> {
  await admin
    .firestore()
    .collection("friendInviteLinks")
    .doc(params.uid)
    .set(
      {
        uid: params.uid,
        env: resolveAppEnv(params.projectId),
        searchId: params.searchId,
        deeplinkUrl: params.deeplinkUrl,
        url: params.url,
        version: friendInviteLinkCacheVersion,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export function buildAirbridgeTrackingLinkPayload(params: {
  searchId: string;
  projectId: string;
  channel?: string;
  customShortId?: string;
  androidFallbackUrl?: string;
  iosFallbackUrl?: string;
  desktopFallbackUrl?: string;
}): AirbridgeTrackingLinkPayload {
  const { fallbackPaths } = appConfigByEnv[resolveAppEnv(params.projectId)];
  const deeplinkUrl = buildFriendInviteDeeplinkUrl(
    params.searchId,
    params.projectId
  );

  const payload: AirbridgeTrackingLinkPayload = {
    channel: params.channel ?? "friend_invite",
    deeplinkUrl,
    isReengagement: "OFF",
    fallbackPaths: {
      android: params.androidFallbackUrl ?? fallbackPaths.android,
      ios: params.iosFallbackUrl ?? fallbackPaths.ios,
      desktop: params.desktopFallbackUrl ?? fallbackPaths.desktop,
    },
  };

  payload.customShortId =
    params.customShortId ?? generateFriendInviteCustomShortId();

  return payload;
}

export function extractTrackingLinkUrl(
  response: AirbridgeTrackingLinkResponse
): string {
  const shortUrl = response.data?.trackingLink?.shortUrl;
  if (shortUrl && shortUrl.trim().length > 0) {
    return shortUrl;
  }

  const clickUrl = response.data?.trackingLink?.link?.click;
  if (clickUrl && clickUrl.trim().length > 0) {
    return clickUrl;
  }

  throw new FriendInviteLinkError(502, {
    error: "招待リンクの生成に失敗しました",
  });
}

async function verifyAuthorizationHeader(
  authHeader: string | string[] | undefined
): Promise<admin.auth.DecodedIdToken> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header || !header.startsWith("Bearer ")) {
    throw new FriendInviteLinkError(401, { error: "認証が必要です" });
  }

  try {
    return await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  } catch {
    throw new FriendInviteLinkError(401, { error: "無効なトークンです" });
  }
}

async function getSearchIdForUser(uid: string): Promise<string> {
  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  const searchId = userDoc.get("searchId");
  if (typeof searchId !== "string" || !searchIdPattern.test(searchId)) {
    throw new FriendInviteLinkError(404, {
      error: "招待リンクを生成できるユーザー情報が見つかりません",
    });
  }

  return searchId;
}

function getProjectId(): string {
  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (firebaseConfig) {
    try {
      const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
      if (parsed.projectId) {
        return parsed.projectId;
      }
    } catch {
      // Fall back to environment variables below.
    }
  }

  return process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
}

function shouldRetryWithoutCustomShortId(params: {
  statusCode: number | undefined;
  payload: AirbridgeTrackingLinkPayload;
  responseBody: string;
}): boolean {
  return (
    params.statusCode === 400 &&
    Boolean(params.payload.customShortId) &&
    params.responseBody.includes("Custom Domain is not set")
  );
}

function requestAirbridgeTrackingLink(
  token: string,
  payload: AirbridgeTrackingLinkPayload
): Promise<AirbridgeTrackingLinkResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      airbridgeTrackingLinkApiUrl,
      {
        method: "POST",
        headers: {
          "Accept-Language": "ja",
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 500) >= 400) {
            if (shouldRetryWithoutCustomShortId({
              statusCode: response.statusCode,
              payload,
              responseBody,
            })) {
              console.warn(
                "Retrying Airbridge tracking link request without customShortId",
                {
                  customShortIdLength: payload.customShortId?.length,
                }
              );
              const retryPayload = { ...payload };
              delete retryPayload.customShortId;
              requestAirbridgeTrackingLink(token, retryPayload)
                .then(resolve)
                .catch(reject);
              return;
            }

            console.error("Airbridge tracking link request failed", {
              statusCode: response.statusCode,
              customShortIdLength: payload.customShortId?.length,
              responseBody: responseBody.slice(0, 1000),
            });
            reject(
              new FriendInviteLinkError(502, {
                error: "招待リンクの生成に失敗しました",
              })
            );
            return;
          }

          try {
            resolve(JSON.parse(responseBody) as AirbridgeTrackingLinkResponse);
          } catch {
            reject(
              new FriendInviteLinkError(502, {
                error: "招待リンクの生成に失敗しました",
              })
            );
          }
        });
      }
    );

    request.on("error", () => {
      reject(
        new FriendInviteLinkError(502, {
          error: "招待リンクの生成に失敗しました",
        })
      );
    });
    request.write(body);
    request.end();
  });
}

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export const createFriendInviteLink = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    secrets: [airbridgeTrackingLinkApiToken],
  },
  async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        response.status(204).send("");
        return;
      }

      if (request.method !== "POST") {
        throw new FriendInviteLinkError(405, {
          error: "POSTメソッドでリクエストしてください",
        });
      }

      const decodedToken = await verifyAuthorizationHeader(
        request.headers.authorization
      );
      const projectId = getProjectId();
      const searchId = await getSearchIdForUser(decodedToken.uid);
      const cachedUrl = await getCachedFriendInviteLinkUrl({
        uid: decodedToken.uid,
        searchId,
        projectId,
      });
      if (cachedUrl) {
        response.status(200).json({ url: cachedUrl });
        return;
      }

      const token = airbridgeTrackingLinkApiToken.value();
      if (!token) {
        throw new FriendInviteLinkError(500, {
          error: "招待リンク生成の設定が不足しています",
        });
      }

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId,
        projectId,
        channel: getEnvValue("AIRBRIDGE_INVITE_CHANNEL"),
        androidFallbackUrl: getEnvValue("AIRBRIDGE_ANDROID_FALLBACK_URL"),
        iosFallbackUrl: getEnvValue("AIRBRIDGE_IOS_FALLBACK_URL"),
        desktopFallbackUrl: getEnvValue("AIRBRIDGE_DESKTOP_FALLBACK_URL"),
      });
      const airbridgeResponse = await requestAirbridgeTrackingLink(
        token,
        payload
      );
      const url = extractTrackingLinkUrl(airbridgeResponse);
      await saveFriendInviteLinkCache({
        uid: decodedToken.uid,
        searchId,
        projectId,
        deeplinkUrl: payload.deeplinkUrl,
        url,
      });
      response.status(200).json({ url });
    } catch (error) {
      if (error instanceof FriendInviteLinkError) {
        response.status(error.status).json(error.response);
        return;
      }

      console.error("createFriendInviteLink failed", error);
      response.status(500).json({ error: "招待リンクの生成に失敗しました" });
    }
  }
);
