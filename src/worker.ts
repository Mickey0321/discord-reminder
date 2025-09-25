export interface Env {
  DISCORD_WEBHOOK_URL: string;
  REMIND_CONFIG: string;   // JSON文字列
  MENTION_USERS?: string;  // "id1,id2"（グローバル既定）
  MENTION_ROLES?: string;  // "role1,id2"
  ENABLE_EVERYONE?: string;
  TRIGGER_TOKEN?: string;
}

type Reminder = {
  cron: string;
  message: string;
  users?: string[];     // 個別ユーザーID
  roles?: string[];     // 個別ロールID
  everyone?: string;    // "1" なら許可
};

const csvToList = (s?: string) =>
  (s ?? "").split(",").map(v => v.trim()).filter(Boolean);

function buildMentions(
  users: string[],
  roles: string[],
  enableEveryone: boolean
) {
  const contentParts: string[] = [];
  if (enableEveryone) contentParts.push("@everyone");
  contentParts.push(...users.map(id => `<@${id}>`));
  contentParts.push(...roles.map(id => `<@&${id}>`));

  const allowed_mentions = {
    parse: enableEveryone ? ["everyone"] as ("everyone")[] : [],
    users,
    roles,
    replied_user: false
  };

  const prefix = contentParts.length ? contentParts.join(" ") + " " : "";
  return { prefix, allowed_mentions };
}

async function postToDiscord(env: Env, message: string, u: string[], r: string[], allowAll: boolean) {
  const { prefix, allowed_mentions } = buildMentions(u, r, allowAll);
  const payload = {
    content: prefix + message,
    allowed_mentions
  };
  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${res.status} ${t}`);
  }
}

function resolveReminder(env: Env, cronExpr?: string): Reminder | null {
  let list: Reminder[];
  try {
    list = JSON.parse(env.REMIND_CONFIG) as Reminder[];
  } catch {
    throw new Error("REMIND_CONFIG が不正です（JSONを確認）");
  }
  const r = list.find(x => x.cron === cronExpr);
  return r ?? null;
}

export default {
  // Cron実行
  async scheduled(controller: ScheduledController, env: Env) {
    const r = resolveReminder(env, controller.cron);
    // 見つからなければ既定メッセージで送る（雑に守る）
    const message = r?.message ?? "リマインド";

    // 個別設定 → グローバル既定の順に適用
    const users = r?.users && r.users.length ? r.users : csvToList(env.MENTION_USERS);
    const roles = r?.roles && r.roles.length ? r.roles : csvToList(env.MENTION_ROLES);
    const everyone = (r?.everyone ?? env.ENABLE_EVERYONE) === "1";

    await postToDiscord(env, message, users, roles, everyone);
  },

  // 手動テスト用（誤爆防止に POST /send + ヘッダトークン）
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    if (url.pathname === "/send" && req.method === "POST") {
      if (req.headers.get("x-trigger-token") !== (env.TRIGGER_TOKEN ?? "")) {
        return new Response("unauthorized", { status: 401 });
      }
      // 手動は任意のcronを指定可能（無指定なら既定メッセージ）
      const cron = url.searchParams.get("cron") ?? undefined;
      const r = cron ? resolveReminder(env, cron) : null;

      const users = r?.users && r.users.length ? r.users : csvToList(env.MENTION_USERS);
      const roles = r?.roles && r.roles.length ? r.roles : csvToList(env.MENTION_ROLES);
      const everyone = (r?.everyone ?? env.ENABLE_EVERYONE) === "1";
      const message = (r?.message ?? "手動リマインド") + " (manual)";

      await postToDiscord(env, message, users, roles, everyone);
      return new Response("ok");
    }

    return new Response("ready", { status: 200 });
  }
} satisfies ExportedHandler<Env>;
