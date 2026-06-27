import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import * as XLSX from "xlsx";
import https from "node:https";
import {
  getOrCreateUser,
  getUserBalance,
  createWithdrawal,
  getWithdrawal,
  updateWithdrawalStatus,
  saveSubmittedFile,
  getSubmittedFile,
  updateFileStatus,
  formatSubId,
  addBalance,
  getUserByTelegramId,
  getAllUsers,
} from "./db.js";
import { logger } from "../lib/logger.js";

const ADMIN_GROUP_ID = process.env["ADMIN_GROUP_ID"];

// ─── Conversation State ───────────────────────────────────────────────────────

type WithdrawalStep =
  | "choosing_method"
  | "entering_account"
  | "entering_amount"
  | "confirming";

interface WithdrawalState {
  step: WithdrawalStep;
  method?: string;
  account?: string;
  amount?: number;
}

const withdrawalStates = new Map<number, WithdrawalState>();
const awaitingFile = new Set<number>();

// ─── Button labels (must match text handlers exactly) ────────────────────────

const BTN_BALANCE = "💰 Balance";
const BTN_FILE = "📁 Submit File";
const BTN_WITHDRAWAL = "💸 Withdrawal";

// ─── Keyboards ────────────────────────────────────────────────────────────────

/** Persistent reply keyboard — appears at the bottom of the chat always */
function mainReplyKeyboard() {
  return new Keyboard()
    .text(BTN_BALANCE)
    .text(BTN_FILE)
    .row()
    .text(BTN_WITHDRAWAL)
    .resized()
    .persistent();
}

function paymentKeyboard() {
  return new InlineKeyboard()
    .text("🟢 bKash", "method_bkash")
    .text("🟠 Nagad", "method_nagad")
    .row()
    .text("🟡 Binance UID", "method_binance")
    .row()
    .text("❌ বাতিল করুন", "cancel_withdrawal");
}

function cancelKeyboard() {
  return new InlineKeyboard().text("❌ বাতিল করুন", "cancel_withdrawal");
}

// ─── Row counting helper ──────────────────────────────────────────────────────

async function countExcelRows(fileUrl: string, fileName: string): Promise<number> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    https.get(fileUrl, (res) => {
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const buf = Buffer.concat(chunks);
          const lower = fileName.toLowerCase();
          if (lower.endsWith(".csv")) {
            const text = buf.toString("utf-8");
            const lines = text.split("\n").filter((l) => l.trim().length > 0);
            resolve(Math.max(0, lines.length - 1)); // minus header
          } else {
            const wb = XLSX.read(buf, { type: "buffer" });
            const sheet = wb.Sheets[wb.SheetNames[0]!];
            if (!sheet) return resolve(0);
            const rows = XLSX.utils.sheet_to_json(sheet);
            resolve(rows.length);
          }
        } catch (err) {
          logger.error({ err }, "Failed to count rows");
          resolve(-1);
        }
      });
      res.on("error", () => resolve(-1));
    }).on("error", () => resolve(-1));
  });
}

// ─── Allowed Excel extensions ─────────────────────────────────────────────────

const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".csv"];

function isExcelFile(fileName?: string): boolean {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ─── File Submission Handler ──────────────────────────────────────────────────

async function handleFileSubmission(
  ctx: Context & { from: NonNullable<Context["from"]> },
  botInstance: Bot,
  fileId: string,
  fileName?: string,
) {
  const userId = ctx.from.id;
  if (!awaitingFile.has(userId)) return;

  // Only accept Excel / CSV
  if (!isExcelFile(fileName)) {
    await ctx.reply(
      `❌ *শুধুমাত্র Excel বা CSV ফাইল গ্রহণযোগ্য।*\n\n` +
        `✅ Supported formats: \`.xlsx\`, \`.xls\`, \`.csv\`\n\n` +
        `সঠিক ফাইল পাঠান:`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ বাতিল করুন", "cancel_file"),
      },
    );
    return;
  }

  awaitingFile.delete(userId);

  const fileRecordId = saveSubmittedFile(userId, fileId, fileName, "excel");
  const subId = formatSubId(fileRecordId);

  // Count rows in the Excel/CSV file
  let rowCount = -1;
  try {
    const fileInfo = await botInstance.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${botInstance.token}/${fileInfo.file_path}`;
    rowCount = await countExcelRows(fileUrl, fileName ?? "");
  } catch (err) {
    logger.error({ err }, "Failed to get file for row count");
  }

  const rowMsg =
    rowCount >= 0
      ? `📊 মোট Data: *${rowCount} টি ফাইল* পাওয়া গেছে`
      : `📊 Data count করা সম্ভব হয়নি`;

  // Notify admin group with approve/reject buttons
  if (ADMIN_GROUP_ID) {
    const from = ctx.from;
    const userTag = from.username ? `@${from.username}` : from.first_name;
    const adminKeyboard = new InlineKeyboard()
      .text("✅ Approve", `approvef_${fileRecordId}`)
      .text("❌ Reject", `rejectf_${fileRecordId}`);

    try {
      await botInstance.api.sendMessage(
        ADMIN_GROUP_ID,
        `📊 *নতুন Excel File Submitted*\n\n` +
          `👤 User: [${userTag}](tg://user?id=${from.id})\n` +
          `🆔 Telegram ID: \`${from.id}\`\n` +
          `📝 File: ${fileName ?? "N/A"}\n` +
          `📈 Rows: ${rowCount >= 0 ? rowCount : "N/A"}\n` +
          `🔖 ${subId}`,
        { parse_mode: "Markdown", reply_markup: adminKeyboard },
      );
      await ctx.forwardMessage(ADMIN_GROUP_ID);
    } catch (err) {
      logger.error({ err }, "Failed to forward file to admin group");
    }
  }

  await ctx.reply(
    `🎉 ধন্যবাদ!\n\n` +
      `✅ আপনার ফাইল সফলভাবে জমা হয়েছে।\n\n` +
      `🆔 Submission ID: ${subId}\n` +
      `${rowMsg}\n` +
      `📋 Status: Pending\n` +
      `💰 রিভিউ সম্পন্ন হলে আপনাকে আপডেট করা হবে।`,
    { parse_mode: "Markdown" },
  );
}

// ─── Register Handlers ────────────────────────────────────────────────────────

function registerHandlers(bot: Bot) {
  const paymentMethods: Record<string, string> = {
    method_bkash: "bKash",
    method_nagad: "Nagad",
    method_binance: "Binance UID",
  };

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    const from = ctx.from!;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);

    await ctx.reply(
      `স্বাগতম *${from.first_name}*! 👋\n\nনিচের বাটনগুলো ব্যবহার করুন:`,
      { parse_mode: "Markdown", reply_markup: mainReplyKeyboard() },
    );
  });

  // ── Balance button ──────────────────────────────────────────────────────────
  bot.hears(BTN_BALANCE, async (ctx) => {
    const from = ctx.from!;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);
    const balance = getUserBalance(from.id);

    await ctx.reply(
      `💰 *আপনার Balance*\n\n💵 মোট Balance: *${balance.toFixed(2)} টাকা*`,
      { parse_mode: "Markdown" },
    );
  });

  // ── Submit File button ──────────────────────────────────────────────────────
  bot.hears(BTN_FILE, async (ctx) => {
    awaitingFile.add(ctx.from!.id);

    await ctx.reply(
      `📊 *Excel File Submit করুন*\n\nআপনার Excel বা CSV ফাইলটি পাঠান।\n\n✅ Supported: \`.xlsx\`, \`.xls\`, \`.csv\``,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ বাতিল করুন", "cancel_file"),
      },
    );
  });

  bot.callbackQuery("cancel_file", async (ctx) => {
    await ctx.answerCallbackQuery();
    awaitingFile.delete(ctx.from.id);
    await ctx.editMessageText("বাতিল করা হয়েছে।");
  });

  // ── Withdrawal button ───────────────────────────────────────────────────────
  bot.hears(BTN_WITHDRAWAL, async (ctx) => {
    const from = ctx.from!;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);

    withdrawalStates.set(from.id, { step: "choosing_method" });

    await ctx.reply(
      `💸 *Withdrawal Request*\n\nকোন মাধ্যমে withdrawal করতে চান?`,
      { parse_mode: "Markdown", reply_markup: paymentKeyboard() },
    );
  });

  // Withdrawal — payment method selection
  bot.callbackQuery(
    ["method_bkash", "method_nagad", "method_binance"],
    async (ctx) => {
      await ctx.answerCallbackQuery();
      const userId = ctx.from.id;
      const state = withdrawalStates.get(userId);
      if (!state || state.step !== "choosing_method") return;

      const method = paymentMethods[ctx.callbackQuery.data]!;
      state.method = method;
      state.step = "entering_account";
      withdrawalStates.set(userId, state);

      const label =
        method === "Binance UID" ? "Binance UID নম্বর" : `${method} নম্বর`;

      await ctx.editMessageText(
        `💸 *Withdrawal — ${method}*\n\nআপনার *${label}* লিখুন:`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() },
      );
    },
  );

  // Withdrawal — cancel
  bot.callbackQuery("cancel_withdrawal", async (ctx) => {
    await ctx.answerCallbackQuery();
    withdrawalStates.delete(ctx.from.id);
    await ctx.editMessageText("বাতিল করা হয়েছে।");
  });

  // Withdrawal — confirm
  bot.callbackQuery("confirm_wd", async (ctx) => {
    const userId = ctx.from.id;
    const state = withdrawalStates.get(userId);

    if (
      !state ||
      state.step !== "confirming" ||
      !state.method ||
      !state.account ||
      !state.amount
    ) {
      await ctx.answerCallbackQuery();
      return;
    }

    // Check sufficient balance
    const currentBalance = getUserBalance(userId);
    if (currentBalance < state.amount) {
      await ctx.answerCallbackQuery("❌ Balance কম!");
      await ctx.editMessageText(
        `❌ *Balance কম!*\n\n` +
          `💰 আপনার Balance: *${currentBalance.toFixed(2)} টাকা*\n` +
          `💸 চাওয়া Amount: *${state.amount} টাকা*\n\n` +
          `পর্যাপ্ত balance নেই।`,
        { parse_mode: "Markdown" },
      );
      withdrawalStates.delete(userId);
      return;
    }

    await ctx.answerCallbackQuery("✅ Request পাঠানো হচ্ছে...");

    // Deduct balance immediately
    addBalance(userId, -state.amount);

    const wdId = createWithdrawal(
      userId,
      state.amount,
      state.method,
      state.account,
    );
    withdrawalStates.delete(userId);

    // Send to admin group
    if (ADMIN_GROUP_ID) {
      const from = ctx.from;
      const userTag = from.username ? `@${from.username}` : from.first_name;
      const now = new Date().toLocaleString("en-GB", {
        timeZone: "Asia/Dhaka",
        dateStyle: "medium",
        timeStyle: "short",
      });

      const adminKeyboard = new InlineKeyboard()
        .text("✅ Approve", `approve_${wdId}`)
        .text("❌ Reject", `reject_${wdId}`);

      try {
        await bot.api.sendMessage(
          ADMIN_GROUP_ID,
          `🔔 *নতুন Withdrawal Request*\n\n` +
            `👤 User: ${userTag}\n` +
            `🆔 Telegram ID: \`${from.id}\`\n` +
            `💰 Amount: *${state.amount} টাকা*\n` +
            `💳 Method: *${state.method}*\n` +
            `📱 Account: \`${state.account}\`\n` +
            `📅 সময়: ${now}\n\n` +
            `🔖 Request ID: #${wdId}`,
          { parse_mode: "Markdown", reply_markup: adminKeyboard },
        );
      } catch (err) {
        logger.error({ err }, "Failed to send withdrawal notification to admin group");
      }
    }

    await ctx.editMessageText(
      `✅ *Withdrawal Request পাঠানো হয়েছে!*\n\n` +
        `🔖 Request ID: #${wdId}\n` +
        `💰 Amount: ${state.amount} টাকা\n` +
        `💳 Method: ${state.method}\n\n` +
        `Admin review করার পর আপনাকে জানানো হবে।`,
      { parse_mode: "Markdown" },
    );
  });

  // ── Admin: Approve / Reject ─────────────────────────────────────────────────
  bot.callbackQuery(/^(approve|reject)_(\d+)$/, async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat?.id) !== ADMIN_GROUP_ID) {
      await ctx.answerCallbackQuery("⛔ Permission নেই!");
      return;
    }

    const action = ctx.match[1] as "approve" | "reject";
    const wdId = parseInt(ctx.match[2]!);

    const wd = getWithdrawal(wdId);
    if (!wd) {
      await ctx.answerCallbackQuery("⚠️ Request পাওয়া যায়নি!");
      return;
    }
    if (wd.status !== "pending") {
      await ctx.answerCallbackQuery("⚠️ এই request ইতিমধ্যে process হয়েছে!");
      return;
    }

    updateWithdrawalStatus(wdId, action === "approve" ? "approved" : "rejected");

    const adminName = ctx.from.first_name;
    const statusLabel = action === "approve" ? "✅ Approved" : "❌ Rejected";
    await ctx.answerCallbackQuery(`${statusLabel}!`);

    const originalText = ctx.msg?.text ?? "";
    try {
      await ctx.editMessageText(
        `${originalText}\n\n${statusLabel} by ${adminName}`,
        { parse_mode: "Markdown" },
      );
    } catch {
      // already edited — ignore
    }

    // Notify user
    const userMsg =
      action === "approve"
        ? `✅ *আপনার Withdrawal Approved হয়েছে!*\n\n` +
          `🔖 Request ID: #${wdId}\n` +
          `💰 Amount: *${wd.amount} টাকা*\n` +
          `💳 Method: ${wd.payment_method}\n` +
          `📱 Account: ${wd.account_number}\n\n` +
          `শীঘ্রই আপনার payment পাঠানো হবে।`
        : `❌ *আপনার Withdrawal Rejected হয়েছে।*\n\n` +
          `🔖 Request ID: #${wdId}\n` +
          `💰 Amount: ${wd.amount} টাকা\n\n` +
          `বিস্তারিত জানতে admin-এর সাথে যোগাযোগ করুন।`;

    try {
      await bot.api.sendMessage(wd.user_id, userMsg, { parse_mode: "Markdown" });
    } catch (err) {
      logger.error({ err, userId: wd.user_id }, "Failed to notify user about withdrawal decision");
    }
  });

  // ── Admin commands ──────────────────────────────────────────────────────────

  bot.command("addbalance", async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat.id) !== ADMIN_GROUP_ID) {
      await ctx.reply("⛔ এই command শুধু admin group-এ ব্যবহার করা যাবে।");
      return;
    }
    const args = ctx.match.trim().split(/\s+/);
    if (args.length !== 2) {
      await ctx.reply(
        `⚠️ *ব্যবহার:* \`/addbalance <telegram_id> <amount>\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const targetId = parseInt(args[0]!);
    const amount = parseFloat(args[1]!);
    if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
      await ctx.reply("⚠️ সঠিক Telegram ID এবং amount দিন।");
      return;
    }
    const user = getUserByTelegramId(targetId);
    if (!user) {
      await ctx.reply(
        `⚠️ Telegram ID \`${targetId}\` এর কোনো user পাওয়া যায়নি।\n\n_User-কে আগে bot-এ /start করতে হবে।_`,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const newBalance = addBalance(targetId, amount);
    const userName = user.username ? `@${user.username}` : user.first_name;
    await ctx.reply(
      `✅ *Balance Add সফল!*\n\n` +
        `👤 User: ${userName}\n` +
        `🆔 ID: \`${targetId}\`\n` +
        `➕ Added: *${amount} টাকা*\n` +
        `💰 নতুন Balance: *${newBalance.toFixed(2)} টাকা*`,
      { parse_mode: "Markdown" },
    );
    try {
      await bot.api.sendMessage(
        targetId,
        `💰 *আপনার Balance Update হয়েছে!*\n\n➕ *${amount} টাকা* যোগ হয়েছে\n💵 নতুন Balance: *${newBalance.toFixed(2)} টাকা*`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      logger.error({ err, targetId }, "Failed to notify user about balance update");
    }
  });

  bot.command("removebalance", async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat.id) !== ADMIN_GROUP_ID) {
      await ctx.reply("⛔ এই command শুধু admin group-এ ব্যবহার করা যাবে।");
      return;
    }
    const args = ctx.match.trim().split(/\s+/);
    if (args.length !== 2) {
      await ctx.reply(
        `⚠️ *ব্যবহার:* \`/removebalance <telegram_id> <amount>\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const targetId = parseInt(args[0]!);
    const amount = parseFloat(args[1]!);
    if (isNaN(targetId) || isNaN(amount) || amount <= 0) {
      await ctx.reply("⚠️ সঠিক Telegram ID এবং amount দিন।");
      return;
    }
    const user = getUserByTelegramId(targetId);
    if (!user) {
      await ctx.reply(
        `⚠️ Telegram ID \`${targetId}\` এর কোনো user পাওয়া যায়নি।`,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const newBalance = addBalance(targetId, -amount);
    const userName = user.username ? `@${user.username}` : user.first_name;
    await ctx.reply(
      `✅ *Balance কাটা সফল!*\n\n` +
        `👤 User: ${userName}\n` +
        `🆔 ID: \`${targetId}\`\n` +
        `➖ Removed: *${amount} টাকা*\n` +
        `💰 নতুন Balance: *${newBalance.toFixed(2)} টাকা*`,
      { parse_mode: "Markdown" },
    );
  });

  bot.command("checkbalance", async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat.id) !== ADMIN_GROUP_ID) {
      await ctx.reply("⛔ এই command শুধু admin group-এ ব্যবহার করা যাবে।");
      return;
    }
    const targetId = parseInt(ctx.match.trim());
    if (isNaN(targetId)) {
      await ctx.reply(
        `⚠️ *ব্যবহার:* \`/checkbalance <telegram_id>\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const user = getUserByTelegramId(targetId);
    if (!user) {
      await ctx.reply(
        `⚠️ Telegram ID \`${targetId}\` এর কোনো user পাওয়া যায়নি।`,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const userName = user.username ? `@${user.username}` : user.first_name;
    await ctx.reply(
      `👤 *User Info*\n\nনাম: ${userName}\n🆔 ID: \`${targetId}\`\n💰 Balance: *${user.balance.toFixed(2)} টাকা*`,
      { parse_mode: "Markdown" },
    );
  });

  // ── /msg — admin only: send message to specific user ───────────────────────
  // Usage: /msg <telegram_id> <message text>
  bot.command("msg", async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat.id) !== ADMIN_GROUP_ID) {
      await ctx.reply("⛔ এই command শুধু admin group-এ ব্যবহার করা যাবে।");
      return;
    }
    const parts = ctx.match.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        `⚠️ *ব্যবহার:* \`/msg <telegram_id> <message>\`\n\nউদাহরণ: \`/msg 123456789 আপনার রিপোর্ট তৈরি হয়েছে!\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const targetId = parseInt(parts[0]!);
    const message = parts.slice(1).join(" ");
    if (isNaN(targetId)) {
      await ctx.reply("⚠️ সঠিক Telegram ID দিন।");
      return;
    }
    try {
      await bot.api.sendMessage(targetId, message);
      await ctx.reply(`✅ Message পাঠানো হয়েছে \`${targetId}\`-কে।`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      logger.error({ err, targetId }, "Failed to send message to user");
      await ctx.reply(`❌ Message পাঠানো যায়নি। User হয়তো bot block করেছে।`);
    }
  });

  // ── /broadcast — admin only: send message to all users ─────────────────────
  bot.command("broadcast", async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat.id) !== ADMIN_GROUP_ID) {
      await ctx.reply("⛔ এই command শুধু admin group-এ ব্যবহার করা যাবে।");
      return;
    }
    const message = ctx.match.trim();
    if (!message) {
      await ctx.reply(
        `⚠️ *ব্যবহার:* \`/broadcast <message>\`\n\nউদাহরণ: \`/broadcast আজকের রিপোর্ট দেওয়া শুরু হয়েছে!\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const users = getAllUsers();
    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await bot.api.sendMessage(user.telegram_id, message);
        sent++;
      } catch {
        failed++;
      }
    }
    await ctx.reply(
      `📢 *Broadcast সম্পন্ন!*\n\n✅ পাঠানো হয়েছে: *${sent} জনকে*\n❌ পাঠানো যায়নি: *${failed} জন*`,
      { parse_mode: "Markdown" },
    );
  });

  // ── Text messages: withdrawal multi-step input ──────────────────────────────
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    // Skip commands and main menu buttons (handled by hears above)
    if (
      text.startsWith("/") ||
      text === BTN_BALANCE ||
      text === BTN_FILE ||
      text === BTN_WITHDRAWAL
    )
      return;

    const state = withdrawalStates.get(userId);
    if (!state) return;

    if (state.step === "entering_account") {
      if (text.length < 3) {
        await ctx.reply("⚠️ সঠিক account number বা UID দিন:", {
          reply_markup: cancelKeyboard(),
        });
        return;
      }
      state.account = text;
      state.step = "entering_amount";
      withdrawalStates.set(userId, state);
      await ctx.reply(
        `💰 *কত টাকা withdrawal করতে চান?*\n\n_(সর্বনিম্ন ২০ টাকা)_`,
        { parse_mode: "Markdown", reply_markup: cancelKeyboard() },
      );
    } else if (state.step === "entering_amount") {
      const amount = parseFloat(text.replace(/[^\d.]/g, ""));
      if (isNaN(amount) || amount < 20) {
        await ctx.reply(
          `⚠️ সর্বনিম্ন withdrawal amount হলো *২০ টাকা*।\n\nআবার লিখুন:`,
          { parse_mode: "Markdown", reply_markup: cancelKeyboard() },
        );
        return;
      }
      state.amount = amount;
      state.step = "confirming";
      withdrawalStates.set(userId, state);

      await ctx.reply(
        `📋 *Withdrawal Summary*\n\n` +
          `💳 Method: *${state.method}*\n` +
          `📱 Account: \`${state.account}\`\n` +
          `💰 Amount: *${amount} টাকা*\n\n` +
          `নিশ্চিত হলে Confirm করুন।`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text("✅ Confirm করুন", "confirm_wd")
            .row()
            .text("❌ বাতিল করুন", "cancel_withdrawal"),
        },
      );
    }
  });

  // ── Excel/CSV document submissions only ────────────────────────────────────
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    await handleFileSubmission(
      ctx as Context & { from: NonNullable<Context["from"]> },
      bot,
      doc.file_id,
      doc.file_name,
    );
  });

  // ── Admin: Approve / Reject file submissions ────────────────────────────────
  bot.callbackQuery(/^(approvef|rejectf)_(\d+)$/, async (ctx) => {
    if (ADMIN_GROUP_ID && String(ctx.chat?.id) !== ADMIN_GROUP_ID) {
      await ctx.answerCallbackQuery("⛔ Permission নেই!");
      return;
    }

    const action = ctx.match[1] as "approvef" | "rejectf";
    const fileId = parseInt(ctx.match[2]!);

    const file = getSubmittedFile(fileId);
    if (!file) {
      await ctx.answerCallbackQuery("⚠️ Submission পাওয়া যায়নি!");
      return;
    }
    if (file.status !== "pending") {
      await ctx.answerCallbackQuery("⚠️ এই submission ইতিমধ্যে process হয়েছে!");
      return;
    }

    const newStatus = action === "approvef" ? "approved" : "rejected";
    updateFileStatus(fileId, newStatus);

    const adminName = ctx.from.first_name;
    const statusLabel = action === "approvef" ? "✅ Approved" : "❌ Rejected";
    await ctx.answerCallbackQuery(`${statusLabel}!`);

    // Update admin group message
    const originalText = ctx.msg?.text ?? "";
    try {
      await ctx.editMessageText(
        `${originalText}\n\n${statusLabel} by ${adminName}`,
        { parse_mode: "Markdown" },
      );
    } catch { /* already edited */ }

    // Notify user
    const subId = formatSubId(fileId);
    const userMsg =
      action === "approvef"
        ? `✅ আপনার ফাইল টি গ্রহণ করা হয়েছে।\n\n🆔 ${subId}\n\nরিপোর্ট এর জন্য অপেক্ষা করুন।`
        : `❌ আপনার ফাইল টি গ্রহণ করা হয়নি।\n\n🆔 ${subId}\n\nবিস্তারিত জানতে admin-এর সাথে যোগাযোগ করুন।`;

    try {
      await bot.api.sendMessage(file.user_id, userMsg);
    } catch (err) {
      logger.error({ err, userId: file.user_id }, "Failed to notify user about file decision");
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

export async function startBot(): Promise<void> {
  const token = process.env["BOT_TOKEN"];
  if (!token) {
    throw new Error("BOT_TOKEN environment variable is required");
  }

  const bot = new Bot(token);

  bot.catch((err) => {
    logger.error({ err }, "Unhandled bot error");
  });

  registerHandlers(bot);

  logger.info("Starting Telegram bot...");
  void bot.start({
    onStart(botInfo) {
      logger.info({ username: botInfo.username }, "Bot started successfully");
    },
  });
}
