import * as admin from "firebase-admin";

export class AdminAuthError extends Error {
  constructor(
    readonly status: number,
    readonly response: { error: string }
  ) {
    super(response.error);
  }
}

export function hasAdminClaim(
  decodedToken: Record<string, unknown>
): boolean {
  return decodedToken.admin === true;
}

export async function verifyAdminAuthorizationHeader(
  authHeader: string | string[] | undefined
): Promise<admin.auth.DecodedIdToken> {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AdminAuthError(401, { error: "認証が必要です" });
  }

  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  } catch {
    throw new AdminAuthError(401, { error: "無効なトークンです" });
  }

  if (!hasAdminClaim(decodedToken)) {
    throw new AdminAuthError(403, { error: "管理者権限が必要です" });
  }

  return decodedToken;
}
