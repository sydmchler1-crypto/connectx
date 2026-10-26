const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function reply(res, status, data) {
  return res.status(status).setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Content-Type", "application/json")
    .json(data);
}

async function redis(command) {
  const url =
    process.env.UPSTASH_REDIS_KV_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

  const token =
    process.env.UPSTASH_REDIS_KV_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) throw new Error("Redis environment variables are missing");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) throw new Error("Redis request failed");
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.result;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  try {
    const now = Date.now();
    const onlineKey = "connectx:online";
    const prefix = "connectx:guest:";

    if (req.method === "POST") {
      const { id, name } = req.body || {};

      if (
        typeof id !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(id) ||
        typeof name !== "string" ||
        name.trim().length < 1 ||
        name.trim().length > 30
      ) {
        return reply(res, 400, { error: "Invalid guest ID or name" });
      }

      const guest = {
        id,
        name: name.trim(),
        lastSeen: now
      };

      await redis(["SET", prefix + id, JSON.stringify(guest), "EX", 90]);
      await redis(["ZADD", onlineKey, now, id]);
      await redis(["ZREMRANGEBYSCORE", onlineKey, 0, now - 90000]);

      return reply(res, 200, {
        success: true,
        message: "Presence updated",
        expiresIn: 90
      });
    }

    if (req.method === "GET") {
      await redis(["ZREMRANGEBYSCORE", onlineKey, 0, now - 90000]);

      const ids = await redis([
        "ZRANGEBYSCORE",
        onlineKey,
        now - 90000,
        "+inf"
      ]);

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply(res, 200, { success: true, users: [] });
      }

      const users = [];

      for (const id of ids.slice(0, 100)) {
        const data = await redis(["GET", prefix + id]);
        if (data) {
          try {
            users.push(JSON.parse(data));
          } catch (_) {}
        }
      }

      return reply(res, 200, {
        success: true,
        users
      });
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return reply(res, 405, { error: "Method not allowed" });

  } catch (error) {
    console.error("ConnectX presence error:", error);
    return reply(res, 500, {
      error: "Presence service unavailable"
    });
  }
};