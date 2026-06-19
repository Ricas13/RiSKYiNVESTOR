import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE = "ri_session";

interface SessionPayload {
  username: string;
  role: "owner" | "user" | "admin";
  expiresAt: number;
  nonce: string;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function readCookies(request: Request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [
          decodeURIComponent(part.slice(0, index)),
          decodeURIComponent(part.slice(index + 1)),
        ];
      }),
  );
}

export function verifyPassword(password: string, encodedHash: string) {
  const [scheme, nValue, rValue, pValue, salt, expectedHash] =
    encodedHash.split("$");
  if (
    scheme !== "scrypt" ||
    !nValue ||
    !rValue ||
    !pValue ||
    !salt ||
    !expectedHash
  ) {
    return false;
  }

  try {
    const derived = scryptSync(password, salt, 64, {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(expectedHash, "base64url");
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function createSession(
  username: string,
  role: SessionPayload["role"],
  secret: string,
  ttlHours: number,
) {
  const payload: SessionPayload = {
    username,
    role,
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function readSession(request: Request, secret: string) {
  const token = readCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload, secret));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (session.expiresAt <= Date.now()) return null;
    if (!["owner", "user", "admin"].includes(session.role)) {
      session.role = "owner";
    }
    return { session, token };
  } catch {
    return null;
  }
}

export function csrfToken(sessionToken: string, secret: string) {
  return sign(`csrf:${sessionToken}`, secret);
}

export function setSessionCookie(
  response: Response,
  token: string,
  secure: boolean,
  ttlHours: number,
) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: ttlHours * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(response: Response, secure: boolean) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
  });
}

export function requireSession(secret: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const result = readSession(request, secret);
    if (!result) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    response.locals.session = result;
    next();
  };
}

export function requireCsrf(secret: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const result = response.locals.session as
      | ReturnType<typeof readSession>
      | undefined;
    const supplied = request.header("x-csrf-token");
    if (!result || !supplied) {
      response.status(403).json({ error: "CSRF validation failed." });
      return;
    }

    const expected = Buffer.from(csrfToken(result.token, secret));
    const received = Buffer.from(supplied);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      response.status(403).json({ error: "CSRF validation failed." });
      return;
    }
    next();
  };
}
