import { Pool } from "@neondatabase/serverless";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const client = await pool.connect();

const campaignId = "ff05c09a-2221-4bcd-a7ef-8ca9e93b6a51";
const canonicalUrl = "https://example.com/";

try {
  await client.query("BEGIN");

  const deleted = await client.query(
    "DELETE FROM campaign_run WHERE campaign_id = $1 RETURNING id",
    [campaignId]
  );

  if (deleted.rowCount !== 1) {
    throw new Error(
      `DELETE esperaba 1 fila y obtuvo ${deleted.rowCount}`
    );
  }

  const updated = await client.query(
    "UPDATE campaign SET destination_url = $1 WHERE id = $2 RETURNING id, destination_url",
    [canonicalUrl, campaignId]
  );

  if (updated.rowCount !== 1) {
    throw new Error(
      `UPDATE esperaba 1 fila y obtuvo ${updated.rowCount}`
    );
  }

  await client.query("COMMIT");

  console.log("TRANSACCION_OK");
  console.log("DELETE:", deleted.rows);
  console.log("UPDATE:", updated.rows);
} catch (error) {
  await client.query("ROLLBACK");
  console.error("TRANSACCION_ABORTADA:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
