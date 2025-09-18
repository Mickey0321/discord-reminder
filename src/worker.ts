export interface Env {
  DISCORD_WEBHOOK_URL: string;   // wrangler secret
  DEFAULT_MESSAGE: string;
  MENTION_USERS?: string;         // "id1,id2"
  MENTION_ROLES?: string;         // "role1,role2"
  ENABLE_EVERYONE?: string;       // "1" で許可
}

function csvToList(s?: string): string[] {
  return (s ?? "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function buildMentionText(users: string[], roles: string[], enableEveryone: boolean): string {
  const u = users.map(id => `<@${id}>`);
  const r = roles.map(id => `<@&${id}>`);
  // みんな鳴らすならここで @everyone を追加
  const all = enableEveryone ? ["@everyone"] : [];
  const tokens = [...all, ...u, ...r];
  return tokens.length ? tokens.join(" ") + " " : "";
}

async function postToDiscord(env: Env, content: string) {
  const users = csvToList(env.MENTION_USERS);
  const roles = csvToList(env.MENTION_ROLES);
  const enableEveryone = env.ENABLE_EVERYONE === "1";

  const payload = {
    content: buildMentionText(users, roles, enableEveryone) + content,
    allowed_mentions: {
      parse: enableEveryone ? ["everyone"] : [], // everyone許可以外は自動解釈オフ
      users,
      roles,
      replied_user: false,
    },
  };

  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${t}`);
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env) {
    await postToDiscord(env, env.DEFAULT_MESSAGE ?? "リマインド");
  },

  // 手動テスト用: POST /send だけで送る。GETや/faviconで誤爆しない構え。
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    if (url.pathname === "/send" && req.method === "POST") {
      const token = req.headers.get("x-trigger-token");
      if (token !== "dev") return new Response("unauthorized", { status: 401 });
      await postToDiscord(env, (env.DEFAULT_MESSAGE ?? "リマインド"));
      return new Response("ok");
    }
    return new Response("ready", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
