import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { randomBytes } from "crypto";
import * as https from "https";

const airbridgeTrackingLinkApiToken = defineSecret(
  "AIRBRIDGE_TRACKING_LINK_API_TOKEN"
);

const searchIdPattern = /^[a-zA-Z0-9]{8}$/;
const airbridgeTrackingLinkApiUrl =
  "https://api.airbridge.io/v1/tracking-links";

type AirbridgeTrackingLinkPayload = {
  channel: string;
  deeplinkUrl: string;
  isReengagement: "OFF";
  customShortId: string;
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

class FriendInviteLinkError extends Error {
  constructor(
    readonly status: number,
    readonly response: { error: string }
  ) {
    super(response.error);
  }
}

export function buildFriendInviteDeeplinkUrl(
  searchId: string,
  projectId: string
): string {
  const scheme = projectId.includes("prod") ? "lakiite" : "lakiitedev";
  return `${scheme}://friend/search?searchId=${encodeURIComponent(searchId)}`;
}

export function generateFriendInviteShortId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(24);
  const token = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
    .join("");

  return `friend_${token}`;
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
  const deeplinkUrl = buildFriendInviteDeeplinkUrl(
    params.searchId,
    params.projectId
  );
  const defaultAndroidFallback =
    params.projectId.includes("prod") ?
      "https://play.google.com/store/apps/details?id=com.inoworl.lakiite" :
      "https://play.google.com/store/apps/details?id=com.inoworl.lakiite.dev";
  const defaultDesktopFallback = params.projectId.includes("prod") ?
    "https://lakiite-flutter-app-prod.web.app" :
    "https://lakiite-flutter-app-dev.web.app";

  return {
    channel: params.channel ?? "friend_invite",
    deeplinkUrl,
    isReengagement: "OFF",
    customShortId: params.customShortId ?? generateFriendInviteShortId(),
    fallbackPaths: {
      android: params.androidFallbackUrl ?? defaultAndroidFallback,
      ios: params.iosFallbackUrl ?? defaultDesktopFallback,
      desktop: params.desktopFallbackUrl ?? defaultDesktopFallback,
    },
  };
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
      const searchId = await getSearchIdForUser(decodedToken.uid);
      const token = airbridgeTrackingLinkApiToken.value();
      if (!token) {
        throw new FriendInviteLinkError(500, {
          error: "招待リンク生成の設定が不足しています",
        });
      }

      const payload = buildAirbridgeTrackingLinkPayload({
        searchId,
        projectId: getProjectId(),
        channel: getEnvValue("AIRBRIDGE_INVITE_CHANNEL"),
        androidFallbackUrl: getEnvValue("AIRBRIDGE_ANDROID_FALLBACK_URL"),
        iosFallbackUrl: getEnvValue("AIRBRIDGE_IOS_FALLBACK_URL"),
        desktopFallbackUrl: getEnvValue("AIRBRIDGE_DESKTOP_FALLBACK_URL"),
      });
      const airbridgeResponse = await requestAirbridgeTrackingLink(
        token,
        payload
      );
      response.status(200).json({ url: extractTrackingLinkUrl(airbridgeResponse) });
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
