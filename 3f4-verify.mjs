import { Pool } from "@neondatabase/serverless";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM campaign_run) AS total_runs,
      (SELECT count(*)::int FROM campaign) AS total_campaigns,
      destination_url
    FROM campaign
    WHERE id = 'ff05c09a-2221-4bcd-a7ef-8ca9e93b6a51';
  `);

  console.log(result.rows);
} finally {
  await pool.end();
}
