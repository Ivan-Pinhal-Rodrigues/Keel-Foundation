import { hash, verify } from "@node-rs/argon2";

// argon2id defaults, OWASP-aligned
const opts = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain: string) => hash(plain, opts);
export const verifyPassword = async (h: string, plain: string) => {
  try {
    return await verify(h, plain, opts);
  } catch {
    return false;
  }
};
