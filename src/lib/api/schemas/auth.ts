import { z } from "zod";

/** `POST /api/auth/login` request body. */
export const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginBody>;
