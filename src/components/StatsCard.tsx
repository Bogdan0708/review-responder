interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "default" | "blue" | "green" | "amber" | "red";
}

const colorMap = {
  default: "bg-white dark:bg-zinc-900",
  blue: "bg-white dark:bg-zinc-900 border-l-4 border-l-blue-500",
  green: "bg-white dark:bg-zinc-900 border-l-4 border-l-emerald-500",
  amber: "bg-white dark:bg-zinc-900 border-l-4 border-l-amber-500",
  red: "bg-white dark:bg-zinc-900 border-l-4 border-l-red-500",
};

export default function StatsCard({
  title,
  value,
  subtitle,
  color = "default",
}: StatsCardProps) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 p-5 dark:border-zinc-800 ${colorMap[color]}`}
    >
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {title}
      </p>
      <p className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}
