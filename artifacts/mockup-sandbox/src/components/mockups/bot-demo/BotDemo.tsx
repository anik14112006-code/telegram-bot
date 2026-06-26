import { useState } from "react";

type Screen =
  | "main"
  | "balance"
  | "submit_file"
  | "wd_method"
  | "wd_account"
  | "wd_amount"
  | "wd_confirm"
  | "wd_done"
  | "file_done"
  | "admin_view";

interface Message {
  from: "bot" | "user";
  text?: string;
  buttons?: { label: string; action: string; color?: string }[][];
  isFile?: boolean;
}

const BOT_NAME = "EarningBot";
const BOT_AVATAR = "🤖";

const SCREENS: Record<Screen, Message[]> = {
  main: [
    {
      from: "bot",
      text: "স্বাগতম **Rahim**! 👋\n\nনিচের অপশনগুলো থেকে বেছে নিন:",
      buttons: [
        [
          { label: "💰 Balance", action: "balance" },
          { label: "📁 Submit File", action: "submit_file" },
        ],
        [{ label: "💸 Withdrawal", action: "wd_method" }],
      ],
    },
  ],
  balance: [
    {
      from: "bot",
      text: "💰 **আপনার Balance**\n\n💵 মোট Balance: **250.00 টাকা**",
      buttons: [[{ label: "🏠 Main Menu", action: "main" }]],
    },
  ],
  submit_file: [
    {
      from: "bot",
      text: "📁 **File Submit করুন**\n\nআপনার ফাইলটি পাঠান।\n_(Document, Photo, Video, Audio)_",
      buttons: [[{ label: "❌ বাতিল করুন", action: "main" }]],
    },
  ],
  file_done: [
    {
      from: "bot",
      text: "📁 **File Submit করুন**\n\nআপনার ফাইলটি পাঠান।",
      buttons: [[{ label: "❌ বাতিল করুন", action: "main" }]],
    },
    { from: "user", text: "📎 task_proof.jpg", isFile: true },
    {
      from: "bot",
      text: "✅ **File সফলভাবে Submit হয়েছে!**\n\n🔖 File ID: #42\n\nAdmin শীঘ্রই review করবেন।",
      buttons: [[{ label: "🏠 Main Menu", action: "main" }]],
    },
  ],
  wd_method: [
    {
      from: "bot",
      text: "💸 **Withdrawal Request**\n\nকোন মাধ্যমে withdrawal করতে চান?",
      buttons: [
        [
          { label: "🟢 bKash", action: "wd_account" },
          { label: "🟠 Nagad", action: "wd_account" },
        ],
        [{ label: "🟡 Binance UID", action: "wd_account" }],
        [{ label: "❌ বাতিল করুন", action: "main" }],
      ],
    },
  ],
  wd_account: [
    {
      from: "bot",
      text: "💸 **Withdrawal — bKash**\n\nআপনার **bKash নম্বর** লিখুন:",
      buttons: [[{ label: "❌ বাতিল করুন", action: "main" }]],
    },
    { from: "user", text: "01712345678" },
    {
      from: "bot",
      text: "💰 **কত টাকা withdrawal করতে চান?**\n\n_(সর্বনিম্ন ২০ টাকা)_",
      buttons: [[{ label: "❌ বাতিল করুন", action: "main" }]],
    },
  ],
  wd_amount: [
    {
      from: "bot",
      text: "💰 **কত টাকা withdrawal করতে চান?**\n\n_(সর্বনিম্ন ২০ টাকা)_",
      buttons: [[{ label: "❌ বাতিল করুন", action: "main" }]],
    },
    { from: "user", text: "200" },
    {
      from: "bot",
      text: "📋 **Withdrawal Summary**\n\n💳 Method: **bKash**\n📱 Account: `01712345678`\n💰 Amount: **200 টাকা**\n\nনিশ্চিত হলে Confirm করুন।",
      buttons: [
        [{ label: "✅ Confirm করুন", action: "wd_done", color: "green" }],
        [{ label: "❌ বাতিল করুন", action: "main" }],
      ],
    },
  ],
  wd_confirm: [
    {
      from: "bot",
      text: "📋 **Withdrawal Summary**\n\n💳 Method: **bKash**\n📱 Account: `01712345678`\n💰 Amount: **200 টাকা**\n\nনিশ্চিত হলে Confirm করুন।",
      buttons: [
        [{ label: "✅ Confirm করুন", action: "wd_done", color: "green" }],
        [{ label: "❌ বাতিল করুন", action: "main" }],
      ],
    },
  ],
  wd_done: [
    {
      from: "bot",
      text: "✅ **Withdrawal Request পাঠানো হয়েছে!**\n\n🔖 Request ID: #18\n💰 Amount: 200 টাকা\n💳 Method: bKash\n\nAdmin review করার পর আপনাকে জানানো হবে।",
      buttons: [[{ label: "🏠 Main Menu", action: "main" }]],
    },
  ],
  admin_view: [
    {
      from: "bot",
      text: "🔔 **নতুন Withdrawal Request**\n\n👤 User: @rahim_user\n🆔 Telegram ID: `987654321`\n💰 Amount: **200 টাকা**\n💳 Method: **bKash**\n📱 Account: `01712345678`\n📅 সময়: 26 Jun 2026, 6:45 PM\n\n🔖 Request ID: #18",
      buttons: [
        [
          { label: "✅ Approve", action: "main", color: "green" },
          { label: "❌ Reject", action: "main", color: "red" },
        ],
      ],
    },
  ],
};

function renderText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*.*?\*\*|`.*?`)/g);
    return (
      <span key={i}>
        {parts.map((part, j) => {
          if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={j}>{part.slice(2, -2)}</strong>;
          if (part.startsWith("`") && part.endsWith("`"))
            return (
              <code
                key={j}
                className="bg-black/20 rounded px-1 font-mono text-xs"
              >
                {part.slice(1, -1)}
              </code>
            );
          if (part.startsWith("_") && part.endsWith("_"))
            return (
              <em key={j} className="opacity-75">
                {part.slice(1, -1)}
              </em>
            );
          return <span key={j}>{part}</span>;
        })}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

export function BotDemo() {
  const [screen, setScreen] = useState<Screen>("main");
  const [tab, setTab] = useState<"user" | "admin">("user");

  const messages = SCREENS[screen];

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "user", label: "👤 User দৃষ্টিভঙ্গি" },
    { key: "admin", label: "🔐 Admin Group" },
  ];

  return (
    <div className="min-h-screen bg-[#17212b] flex items-center justify-center p-6">
      <div className="w-full max-w-[390px] flex flex-col gap-4">
        {/* Tab switcher */}
        <div className="flex gap-2 bg-[#0e1621] rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setScreen(t.key === "admin" ? "admin_view" : "main");
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                tab === t.key
                  ? "bg-[#2b5278] text-white"
                  : "text-[#708499] hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Phone frame */}
        <div className="bg-[#0e1621] rounded-2xl overflow-hidden shadow-2xl border border-white/5">
          {/* Header */}
          <div className="bg-[#17212b] px-4 py-3 flex items-center gap-3 border-b border-white/5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#2b5278] to-[#5288c1] flex items-center justify-center text-lg">
              {BOT_AVATAR}
            </div>
            <div>
              <div className="text-white text-sm font-semibold">{BOT_NAME}</div>
              <div className="text-[#708499] text-xs">
                {tab === "admin" ? "Admin Group" : "bot"}
              </div>
            </div>
            <div className="ml-auto flex gap-1">
              <div className="w-2 h-2 rounded-full bg-[#4fae4e] animate-pulse" />
            </div>
          </div>

          {/* Chat area */}
          <div className="p-4 flex flex-col gap-3 min-h-[460px] bg-[#0e1621]">
            {/* Flow navigation (user tab only) */}
            {tab === "user" && (
              <div className="flex flex-wrap gap-1 mb-1">
                {(
                  [
                    ["main", "🏠 Start"],
                    ["balance", "💰 Balance"],
                    ["submit_file", "📁 File"],
                    ["file_done", "📁 Done"],
                    ["wd_method", "💸 Method"],
                    ["wd_account", "📱 Account"],
                    ["wd_amount", "💰 Amount"],
                    ["wd_done", "✅ Done"],
                  ] as [Screen, string][]
                ).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => setScreen(s)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                      screen === s
                        ? "bg-[#2b5278] text-white"
                        : "bg-[#17212b] text-[#708499] hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] ${msg.from === "bot" ? "flex flex-col gap-2" : ""}`}
                >
                  {/* Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.from === "bot"
                        ? "bg-[#17212b] text-[#e8e8e8] rounded-tl-sm"
                        : msg.isFile
                          ? "bg-[#2b5278] text-white rounded-tr-sm flex items-center gap-2"
                          : "bg-[#2b5278] text-white rounded-tr-sm"
                    }`}
                  >
                    {msg.isFile ? (
                      <>
                        <span className="text-lg">🖼️</span>
                        <span className="text-xs">{msg.text}</span>
                      </>
                    ) : (
                      renderText(msg.text ?? "")
                    )}
                  </div>

                  {/* Inline buttons */}
                  {msg.buttons && (
                    <div className="flex flex-col gap-1 mt-1">
                      {msg.buttons.map((row, ri) => (
                        <div key={ri} className="flex gap-1">
                          {row.map((btn, bi) => (
                            <button
                              key={bi}
                              onClick={() => {
                                if (btn.action !== "main" || screen !== "main")
                                  setScreen(btn.action as Screen);
                              }}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                                btn.color === "green"
                                  ? "bg-[#4fae4e]/20 text-[#4fae4e] hover:bg-[#4fae4e]/30 border border-[#4fae4e]/30"
                                  : btn.color === "red"
                                    ? "bg-[#e53935]/20 text-[#e53935] hover:bg-[#e53935]/30 border border-[#e53935]/30"
                                    : "bg-[#2b5278]/60 text-[#5288c1] hover:bg-[#2b5278] border border-[#2b5278]/50"
                              }`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Input bar */}
          <div className="bg-[#17212b] px-3 py-2.5 flex items-center gap-2 border-t border-white/5">
            <button className="text-[#708499] hover:text-[#5288c1] transition-colors">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
              </svg>
            </button>
            <div className="flex-1 bg-[#0e1621] rounded-xl px-3 py-2 text-xs text-[#708499]">
              Message...
            </div>
            <button className="text-[#5288c1] hover:text-[#6ea8e0] transition-colors">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="text-center text-[#708499] text-[11px]">
          উপরের বাটনে ক্লিক করে বিভিন্ন screen দেখুন
        </div>
      </div>
    </div>
  );
}
