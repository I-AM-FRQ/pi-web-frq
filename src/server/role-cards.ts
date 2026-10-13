import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

/**
 * 角色卡：预设提示词，以 markdown 文件形式存放，文件名即角色名（如「开发者.md」）。
 *
 * - 目录：~/.pi/agent/role-cards/（可用 PI_WEB_ROLE_CARDS_DIR 覆盖，便于测试隔离）
 * - 动态获取：每次注入前读取文件内容，编辑文件后无需重启即生效
 * - 名称安全：只接受纯文件名（不允许路径分隔符或 ..），避免目录穿越
 */

const ROLE_CARDS_DIR = process.env.PI_WEB_ROLE_CARDS_DIR || join(homedir(), ".pi", "agent", "role-cards");
const MAX_ROLE_CARD_BYTES = 64 * 1024;
const NAME_PATTERN = /^[^/\\:*?"<>|.][^/\\:*?"<>|]{0,39}$/;

export type RoleCard = {
  /** 角色名（文件名去掉 .md） */
  name: string;
  /** 内容摘要（首行非空文本，供列表展示） */
  summary: string;
  /** 完整内容（每轮注入的提示词） */
  content: string;
  /** 文件绝对路径 */
  path: string;
};

export function roleCardsDirectory(): string {
  return ROLE_CARDS_DIR;
}

/** 校验角色卡名称：必须是安全的纯文件名（不含路径分隔符、不以点开头）。 */
export function validRoleCardName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value.trim()) && !value.trim().includes("..");
}

function normalizeName(value: string): string {
  return value.trim().replace(/\.md$/i, "");
}

function summarize(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }
  return "";
}

/** 列出可用角色卡（按名称排序）。目录不存在时返回空列表。 */
export async function listRoleCards(): Promise<RoleCard[]> {
  let entries: string[];
  try {
    entries = await readdir(ROLE_CARDS_DIR);
  } catch {
    return [];
  }
  const cards: RoleCard[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const name = normalizeName(entry);
    if (!validRoleCardName(name)) continue;
    const path = join(ROLE_CARDS_DIR, entry);
    try {
      const content = await readFile(path, "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_ROLE_CARD_BYTES) continue;
      cards.push({ name, summary: summarize(content), content: content.trim(), path });
    } catch {
      // 读取失败（权限/占用）时跳过该文件
    }
  }
  return cards.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

/** 读取单个角色卡内容；不存在或名称非法时返回 undefined（调用方跳过注入）。 */
export async function readRoleCard(name: string): Promise<string | undefined> {
  const normalized = normalizeName(name);
  if (!validRoleCardName(normalized)) return undefined;
  try {
    const content = await readFile(join(ROLE_CARDS_DIR, `${normalized}.md`), "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_ROLE_CARD_BYTES) return undefined;
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** 写入角色卡（用于 UI 保存）。名称非法或内容过大时抛错。 */
export async function writeRoleCard(name: string, content: string): Promise<RoleCard> {
  const normalized = normalizeName(name);
  if (!validRoleCardName(normalized)) throw new Error("角色卡名称无效（不允许路径字符，长度 1-40）。");
  const trimmed = content.trim();
  if (!trimmed) throw new Error("角色卡内容不能为空。");
  if (Buffer.byteLength(trimmed, "utf8") > MAX_ROLE_CARD_BYTES) throw new Error("角色卡内容过长（上限 64 KiB）。");
  await mkdir(ROLE_CARDS_DIR, { recursive: true });
  const path = join(ROLE_CARDS_DIR, `${normalized}.md`);
  await writeFile(path, `${trimmed}\n`, "utf8");
  return { name: normalized, summary: summarize(trimmed), content: trimmed, path };
}

/** 首次使用时写入几个内置示例角色卡（仅在目录为空时执行）。 */
export async function ensureSampleRoleCards(): Promise<void> {
  try {
    const existing = await readdir(ROLE_CARDS_DIR);
    if (existing.some((entry) => entry.toLowerCase().endsWith(".md"))) return;
  } catch {
    // 目录不存在则继续创建
  }
  const samples: Array<{ name: string; content: string }> = [
    { name: "开发者", content: "# 开发者\n\n你负责把讨论结论落成可运行、可维护的实现：\n\n- 给出具体改动（文件、接口、数据结构）与关键边界处理\n- 说明验证方式（命令、预期结果）\n- 不确定处显式标注为假设，不假装已完成" },
    { name: "审查者", content: "# 审查者\n\n你负责独立核对其他角色的结论：\n\n- 逐条检查证据是否充分、逻辑是否有跳跃\n- 找出未被发现的反例或失败样例\n- 只依据可验证的事实发言，必要时给出复现步骤" },
    { name: "架构师", content: "# 架构师\n\n你关注系统边界、接口契约与长期可演进性：\n\n- 评估可扩展性、耦合度、失败模式与迁移成本\n- 明确给出取舍建议与理由\n- 阻止为了短期方便而牺牲长期结构" },
    { name: "产品经理", content: "# 产品经理\n\n你关注用户价值与交付范围：\n\n- 明确目标、验收标准与优先级\n- 阻止范围蔓延，砍掉不影响验收的内容\n- 确保每一步产出都能被验收" },
  ];
  try {
    await mkdir(ROLE_CARDS_DIR, { recursive: true });
    for (const sample of samples) {
      await writeFile(join(ROLE_CARDS_DIR, `${basename(sample.name, extname(sample.name))}.md`), `${sample.content}\n`, { encoding: "utf8", flag: "wx" });
    }
  } catch {
    // 并发写入冲突（已存在）时忽略
  }
}
