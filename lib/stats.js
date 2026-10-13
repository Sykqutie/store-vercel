'use strict';
// Revenue and chart queries shared by the dashboard and the reports page.
const { query } = require('./db');

function tz() {
  const name = process.env.STORE_TZ || 'Asia/Manila';
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return name;
  } catch (_) {
    return 'UTC';
  }
}

// Day / week (Monday start) / month totals in the store's time zone.
async function periodStats() {
  const { rows: [r] } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE d = today)::int AS day_count,
       COALESCE(SUM(total_amount) FILTER (WHERE d = today), 0)::float8 AS day_revenue,
       COALESCE(SUM(profit)       FILTER (WHERE d = today), 0)::float8 AS day_profit,
       COALESCE(SUM(total_amount) FILTER (WHERE date_trunc('week', d::timestamp) = date_trunc('week', today::timestamp)), 0)::float8 AS week_revenue,
       COALESCE(SUM(profit)       FILTER (WHERE date_trunc('week', d::timestamp) = date_trunc('week', today::timestamp)), 0)::float8 AS week_profit,
       COALESCE(SUM(total_amount) FILTER (WHERE date_trunc('month', d::timestamp) = date_trunc('month', today::timestamp)), 0)::float8 AS month_revenue,
       COALESCE(SUM(profit)       FILTER (WHERE date_trunc('month', d::timestamp) = date_trunc('month', today::timestamp)), 0)::float8 AS month_profit
     FROM (
       SELECT total_amount, profit,
              (sale_date AT TIME ZONE $1)::date AS d,
              (now() AT TIME ZONE $1)::date AS today
       FROM sales
     ) t`,
    [tz()]
  );
  return r;
}

// Last 7 days, including days with no sales (they show 0).
async function chart7() {
  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE $1)::date - 6, (now() AT TIME ZONE $1)::date, interval '1 day')::date AS d
     )
     SELECT to_char(days.d, 'Mon DD') AS label,
            COALESCE(SUM(s.total_amount), 0)::float8 AS revenue,
            COALESCE(SUM(s.profit), 0)::float8 AS profit
     FROM days
     LEFT JOIN sales s ON (s.sale_date AT TIME ZONE $1)::date = days.d
     GROUP BY days.d
     ORDER BY days.d`,
    [tz()]
  );
  return {
    labels: rows.map((r) => r.label),
    revenue: rows.map((r) => r.revenue),
    profit: rows.map((r) => r.profit)
  };
}

module.exports = { tz, periodStats, chart7 };
