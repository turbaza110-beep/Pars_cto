import { FastifyReply, FastifyRequest } from "fastify";

import { getUserById } from "@/services/user/userService";
import { AuthError, NotFoundError } from "@/utils/errors";

export async function getCurrentUser(request: FastifyRequest, _reply: FastifyReply) {
  const userId = request.user?.id;
  if (!userId) {
    throw new AuthError("Authentication token is invalid");
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  request.user = user;
}
