"use client";
import React, { useState } from "react";

interface DepositWithdrawWidgetProps {
  /** Preview function: assets → shares */
  previewDeposit: (amount: bigint) => Promise<bigint>;
  /** Preview function: shares → assets */
  previewWithdraw: (shares: bigint) => Promise<bigint>;
  /** Execute a deposit */
  onDeposit: (amount: bigint) => Promise<string>;
  /** Execute a withdrawal */
  onWithdraw: (shares: bigint) => Promise<string>;
  /** User's current USDC balance (6-decimal) */
  usdcBalance?: bigint;
  /** User's current share balance */
  shareBalance?: bigint;
  /** Whether a wallet is connected */
  isConnected?: boolean;
  /** Connect wallet callback */
  onConnect?: () => void;
}

type Mode  = "deposit" | "withdraw";
type TxStatus = "idle" | "pending" | "confirmed" | "error";

function formatUSDC(raw: bigint): string {
  return (Number(raw) / 1_000_000).toFixed(2);
}

function parseUSDC(str: string): bigint {
  const n = parseFloat(str);
  if (isNaN(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1_000_000));
}

/**
 * DepositWithdrawWidget — toggle between deposit and withdraw flows.
 * Shows real-time share/USDC preview via ERC-4626 previewDeposit/previewRedeem.
 */
export function DepositWithdrawWidget({
  previewDeposit,
  previewWithdraw,
  onDeposit,
  onWithdraw,
  usdcBalance   = 0n,
  shareBalance  = 0n,
  isConnected   = false,
  onConnect,
}: DepositWithdrawWidgetProps) {
  const [mode,    setMode]    = useState<Mode>("deposit");
  const [amount,  setAmount]  = useState("");
  const [preview, setPreview] = useState<bigint | null>(null);
  const [status,  setStatus]  = useState<TxStatus>("idle");
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [errMsg,  setErrMsg]  = useState<string | null>(null);

  const handleAmountChange = async (value: string) => {
    setAmount(value);
    setPreview(null);
    const raw = parseUSDC(value);
    if (raw === 0n) return;
    try {
      if (mode === "deposit") {
        setPreview(await previewDeposit(raw));
      } else {
        setPreview(await previewWithdraw(raw));
      }
    } catch {}
  };

  const handleMax = () => {
    const max = mode === "deposit" ? usdcBalance : shareBalance;
    handleAmountChange(formatUSDC(max));
  };

  const handleSubmit = async () => {
    if (!isConnected) { onConnect?.(); return; }
    const raw = parseUSDC(amount);
    if (raw === 0n) return;

    setStatus("pending");
    setErrMsg(null);
    try {
      const hash = mode === "deposit"
        ? await onDeposit(raw)
        : await onWithdraw(raw);
      setTxHash(hash);
      setStatus("confirmed");
      setAmount("");
      setPreview(null);
    } catch (err: any) {
      setErrMsg(err?.message ?? "Transaction failed");
      setStatus("error");
    }
  };

  const modeLabel = mode === "deposit" ? "Deposit" : "Withdraw";

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6">
      {/* Toggle */}
      <div className="flex rounded-xl bg-gray-100 p-1 mb-5">
        {(["deposit", "withdraw"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setAmount(""); setPreview(null); }}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === m
                ? "bg-white text-indigo-700 shadow"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {mode === "deposit" ? "USDC Amount" : "Shares to Redeem"}
      </label>
      <div className="flex items-center border border-gray-300 rounded-xl px-3 py-2 mb-2">
        <input
          type="number"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          className="flex-1 bg-transparent outline-none text-lg font-mono text-gray-900"
        />
        <button
          onClick={handleMax}
          className="ml-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          MAX
        </button>
      </div>

      {/* Balance */}
      <p className="text-xs text-gray-400 mb-4">
        {mode === "deposit"
          ? `Balance: ${formatUSDC(usdcBalance)} USDC`
          : `Shares: ${formatUSDC(shareBalance)} xVAULT`}
      </p>

      {/* Preview */}
      {preview != null && (
        <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 mb-4 text-sm">
          <span className="text-indigo-600 font-medium">You will receive: </span>
          <span className="font-bold text-indigo-900">
            {mode === "deposit"
              ? `${formatUSDC(preview)} xVAULT shares`
              : `${formatUSDC(preview)} USDC`}
          </span>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={status === "pending"}
        className="w-full py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {!isConnected
          ? "Connect Wallet"
          : status === "pending"
          ? "Processing…"
          : modeLabel}
      </button>

      {/* Status modal */}
      {status === "confirmed" && txHash && (
        <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          ✅ {modeLabel} confirmed!{" "}
          <a
            href={`https://explorer.hsk.xyz/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View tx
          </a>
        </div>
      )}
      {status === "error" && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          ❌ {errMsg}
        </div>
      )}
    </div>
  );
}
