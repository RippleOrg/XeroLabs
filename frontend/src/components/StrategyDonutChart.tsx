"use client";
import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface StrategyAllocation {
  strategyAddress:   string;
  currentValueUSDC:  bigint;
  allocationPercent: number;
  name?:             string;
  apy?:              number;
}

interface StrategyDonutChartProps {
  allocations: StrategyAllocation[];
}

const COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUSDC(raw: bigint): string {
  return (Number(raw) / 1_000_000).toLocaleString("en-US", {
    style:            "currency",
    currency:         "USD",
    minimumFractionDigits: 2,
  });
}

interface CustomTooltipProps {
  active?:   boolean;
  payload?:  any[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as StrategyAllocation;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-900">{d.name ?? shortAddress(d.strategyAddress)}</p>
      <p className="text-gray-600">Value: {formatUSDC(d.currentValueUSDC)}</p>
      <p className="text-gray-600">Allocation: {d.allocationPercent.toFixed(1)}%</p>
      {d.apy != null && (
        <p className="text-green-600 font-medium">APY: {d.apy.toFixed(2)}%</p>
      )}
    </div>
  );
}

/**
 * StrategyDonutChart — shows allocation % per strategy with APY in tooltip.
 */
export function StrategyDonutChart({ allocations }: StrategyDonutChartProps) {
  if (!allocations.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No strategy data available
      </div>
    );
  }

  const data = allocations.map((a, i) => ({
    ...a,
    name:  a.name ?? `Strategy ${i + 1}`,
    value: a.allocationPercent,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={70}
          outerRadius={110}
          paddingAngle={3}
          dataKey="value"
          animationBegin={0}
          animationDuration={800}
        >
          {data.map((_entry, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value: string, entry: any) =>
            `${entry.payload.name} (${entry.payload.allocationPercent.toFixed(1)}%)`
          }
          wrapperStyle={{ fontSize: "12px" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
