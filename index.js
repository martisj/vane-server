import fastify from "fastify";

fastify.get("/", (request, reply) => {
  return "When i was young";
});
