import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface TokenPayload {
  uid: string;
  email: string;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "15m", // Short-lived access token for security
  });
};

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(64).toString("hex");
};
