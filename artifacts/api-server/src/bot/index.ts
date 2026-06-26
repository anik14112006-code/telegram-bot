import { Bot, Context, InlineKeyboard } from "grammy";
import {
  getOrCreateUser,
  getUserBalance,
  createWithdrawal,
  getWithdrawal,
  updateWithdrawalStatus,
  saveSubmittedFile,
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

// ─── Keyboards ────────────────────────────────────────────────────────────────

function mainKeyboard() {
  return new InlineKeyboard()
    .text("💰 Balance", "balance")
    .text("📁 Submit File", "submit_file")
    .row()
    .text("💸 Withdrawal", "withdrawal");
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

function homeKeyboard() {
  return new InlineKeyboard().text("🏠 Main Menu", "back_home");
}

// ─── File Submission Helper ───────────────────────────────────────────────────

async function handleFileSubmission(
  ctx: Context & { from: NonNullable<Context["from"]> },
  botInstance: Bot,
  fileId: string,
  fileType: string,
  fileName?: string,
) {
  const userId = ctx.from.id;

  if (!awaitingFile.has(userId)) return;
  awaitingFile.delete(userId);

  const fileRecordId = saveSubmittedFile(userId, fileId, fileName, fileType);

  if (ADMIN_GROUP_ID) {
    const from = ctx.from;
    const userTag = from.username ? `@${from.username}` : from.first_name;

    try {
      await botInstance.api.sendMessage(
        ADMIN_GROUP_ID,
        `📁 *নতুন File Submitted*\n\n` +
          `👤 User: ${userTag}\n` +
          `🆔 Telegram ID: \`${from.id}\`\n` +
          `📄 Type: ${fileType}\n` +
          (fileName ? `📝 Name: ${fileName}\n` : "") +
          `🔖 File ID: #${fileRecordId}`,
        { parse_mode: "Markdown" },
      );
      await ctx.forwardMessage(ADMIN_GROUP_ID);
    } catch (err) {
      logger.error({ err }, "Failed to forward file to admin group");
    }
  }

  await ctx.reply(
    `✅ *File সফলভাবে Submit হয়েছে!*\n\n🔖 File ID: #${fileRecordId}\n\nAdmin শীঘ্রই review করবেন।`,
    { parse_mode: "Markdown", reply_markup: homeKeyboard() },
  );
}

// ─── Register Handlers ────────────────────────────────────────────────────────

function registerHandlers(bot: Bot) {
  const paymentMethods: Record<string, string> = {
    method_bkash: "bKash",
    method_nagad: "Nagad",
    method_binance: "Binance UID",
  };

  // /start
  bot.command("start", async (ctx) => {
    const from = ctx.from!;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);

    await ctx.reply(
      `স্বাগতম *${from.first_name}*! 👋\n\nনিচের অপশনগুলো থেকে বেছে নিন:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard() },
    );
  });

  // Balance
  bot.callbackQuery("balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    const from = ctx.from;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);
    const balance = getUserBalance(from.id);

    await ctx.editMessageText(
      `💰 *আপনার Balance*\n\n💵 মোট Balance: *${balance.toFixed(2)} টাকা*`,
      { parse_mode: "Markdown", reply_markup: homeKeyboard() },
    );
  });

  // Submit File
  bot.callbackQuery("submit_file", async (ctx) => {
    await ctx.answerCallbackQuery();
    awaitingFile.add(ctx.from.id);

    await ctx.editMessageText(
      `📁 *File Submit করুন*\n\nআপনার ফাইলটি পাঠান।\n_(Document, Photo, Video, Audio — সব ধরনের ফাইল পাঠাতে পারবেন)_`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("❌ বাতিল করুন", "cancel_file"),
      },
    );
  });

  bot.callbackQuery("cancel_file", async (ctx) => {
    await ctx.answerCallbackQuery();
    awaitingFile.delete(ctx.from.id);
    await ctx.editMessageText(
      `স্বাগতম *${ctx.from.first_name}*! 👋\n\nনিচের অপশনগুলো থেকে বেছে নিন:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard() },
    );
  });

  // Withdrawal — start
  bot.callbackQuery("withdrawal", async (ctx) => {
    await ctx.answerCallbackQuery();
    const from = ctx.from;
    getOrCreateUser(from.id, from.first_name, from.last_name, from.username);

    withdrawalStates.set(from.id, { step: "choosing_method" });

    await ctx.editMessageText(
      `💸 *Withdrawal Request*\n\nকোন মাধ্যমে withdrawal করতে চান?`,
      { parse_mode: "Markdown", reply_markup: paymentKeyboard() },
    );
  });

  // Withdrawal — payment method
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

    await ctx.editMessageText(
      `স্বাগতম *${ctx.from.first_name}*! 👋\n\nনিচের অপশনগুলো থেকে বেছে নিন:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard() },
    );
  });

  // Withdrawal — confirm
  bot.callbackQuery("confirm_wd", async (ctx) => {
    await ctx.answerCallbackQuery("✅ Request পাঠানো হচ্ছে...");
    const userId = ctx.from.id;
    const state = withdrawalStates.get(userId);

    if (
      !state ||
      state.step !== "confirming" ||
      !state.method ||
      !state.account ||
      !state.amount
    ) {
      return;
    }

    const wdId = createWithdrawal(
      userId,
      state.amount,
      state.method,
      state.account,
    );
    withdrawalStates.delete(userId);

    if (ADMIN_GROUP_ID) {
      const from = ctx.from;
      const userTag = from.username ? `@${from.username}` : from.first_name;
      const now = new Date().toLocaleString("en-GB", {
        timeZone: "Asia/Dhaka",
        dateStyle: "medium",
        timeStyle: "short",
      });

      const adminMsg =
        `🔔 *নতুন Withdrawal Request*\n\n` +
        `👤 User: ${userTag}\n` +
        `🆔 Telegram ID: \`${from.id}\`\n` +
        `💰 Amount: *${state.amount} টাকা*\n` +
        `💳 Method: *${state.method}*\n` +
        `📱 Account: \`${state.account}\`\n` +
        `📅 সময়: ${now}\n\n` +
        `🔖 Request ID: #${wdId}`;

      const adminKeyboard = new InlineKeyboard()
        .text("✅ Approve", `approve_${wdId}`)
        .text("❌ Reject", `reject_${wdId}`);

      try {
        await bot.api.sendMessage(ADMIN_GROUP_ID, adminMsg, {
          parse_mode: "Markdown",
          reply_markup: adminKeyboard,
        });
      } catch (err) {
        logger.error(
          { err },
          "Failed to send withdrawal notification to admin group",
        );
      }
    }

    await ctx.editMessageText(
      `✅ *Withdrawal Request পাঠানো হয়েছে!*\n\n` +
        `🔖 Request ID: #${wdId}\n` +
        `💰 Amount: ${state.amount} টাকা\n` +
        `💳 Method: ${state.method}\n\n` +
        `Admin review করার পর আপনাকে জানানো হবে।`,
      { parse_mode: "Markdown", reply_markup: homeKeyboard() },
    );
  });

  // Back home
  bot.callbackQuery("back_home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `স্বাগতম *${ctx.from.first_name}*! 👋\n\nনিচের অপশনগুলো থেকে বেছে নিন:`,
      { parse_mode: "Markdown", reply_markup: mainKeyboard() },
    );
  });

  // Admin: Approve / Reject — only process from the configured admin group
  bot.callbackQuery(/^(approve|reject)_(\d+)$/, async (ctx) => {
    // Authorization: only allow from the configured admin group
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

    const status = action === "approve" ? "approved" : "rejected";
    updateWithdrawalStatus(wdId, status);

    const adminName = ctx.from.first_name;
    const statusLabel = action === "approve" ? "✅ Approved" : "❌ Rejected";

    await ctx.answerCallbackQuery(`${statusLabel}!`);

    // Update admin group message
    const originalText = ctx.msg?.text ?? "";
    try {
      await ctx.editMessageText(
        `${originalText}\n\n${statusLabel} by ${adminName}`,
        { parse_mode: "Markdown" },
      );
    } catch {
      // already edited or unchanged — ignore
    }

    // Notify the user
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
      await bot.api.sendMessage(wd.user_id, userMsg, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      logger.error(
        { err, userId: wd.user_id },
        "Failed to notify user about withdrawal decision",
      );
    }
  });

  // Text messages (account number / amount input)
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (text.startsWith("/")) return;

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

      const confirmKeyboard = new InlineKeyboard()
        .text("✅ Confirm করুন", "confirm_wd")
        .row()
        .text("❌ বাতিল করুন", "cancel_withdrawal");

      await ctx.reply(
        `📋 *Withdrawal Summary*\n\n` +
          `💳 Method: *${state.method}*\n` +
          `📱 Account: \`${state.account}\`\n` +
          `💰 Amount: *${amount} টাকা*\n\n` +
          `নিশ্চিত হলে Confirm করুন।`,
        { parse_mode: "Markdown", reply_markup: confirmKeyboard },
      );
    }
  });

  // File / media submissions
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    await handleFileSubmission(
      ctx as Context & { from: NonNullable<Context["from"]> },
      bot,
      doc.file_id,
      "document",
      doc.file_name,
    );
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1]!;
    await handleFileSubmission(
      ctx as Context & { from: NonNullable<Context["from"]> },
      bot,
      photo.file_id,
      "photo",
    );
  });

  bot.on("message:video", async (ctx) => {
    const video = ctx.message.video;
    await handleFileSubmission(
      ctx as Context & { from: NonNullable<Context["from"]> },
      bot,
      video.file_id,
      "video",
      video.file_name,
    );
  });

  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;
    await handleFileSubmission(
      ctx as Context & { from: NonNullable<Context["from"]> },
      bot,
      audio.file_id,
      "audio",
      audio.file_name,
    );
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
